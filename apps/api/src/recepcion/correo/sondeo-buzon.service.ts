import { Inject, Injectable, Logger, type OnModuleDestroy, type OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { noEncontrado, ProblemaHttp } from '../../comun/problema.js';
import { comoSistema, conContextoEmpresa } from '../../database/contexto-empresa.js';
import { EjecutorEmpresa } from '../../database/ejecutor-empresa.js';
import type { Empresa } from '../../empresas/entities/empresa.entity.js';
import { EmpresasService } from '../../empresas/empresas.service.js';
import { BuzonCorreo } from '../entities/buzon-correo.entity.js';
import { RecepcionService } from '../recepcion.service.js';
import { BuzonService } from './buzon.service.js';
import { FABRICA_CORREO, type FabricaCorreo } from './tipos.js';

export interface ResumenSondeo {
  /** Mensajes no leídos encontrados. */
  mensajes: number;
  /** Adjuntos XML procesados. */
  adjuntos: number;
  /** Envíos nuevos guardados. */
  nuevos: number;
  /** Adjuntos que ya estaban recibidos (mismo SHA-256). */
  repetidos: number;
  /** Acuses RecepcionEnvio enviados por SMTP al remitente. */
  acusesEnviados: number;
  errores: string[];
}

/**
 * Sondeo del buzón de intercambio: lee los mensajes no leídos, procesa los adjuntos XML igual que la subida
 * (`RecepcionService.recibirParaEmpresa`) y marca el mensaje como leído (o lo mueve a `carpeta_procesados`).
 * Si el buzón tiene SMTP, responde al remitente con el acuse `RecepcionEnvio`.
 *
 * El sondeo automático está desactivado por defecto (`BUZON_CORREO_HABILITADO=false`) y nunca arranca con
 * `NODE_ENV=test`. Con varias instancias de la API, dos sondeos simultáneos del mismo buzón no duplican datos:
 * la deduplicación por SHA-256 los absorbe (a lo más se responde dos veces el acuse).
 */
@Injectable()
export class SondeoBuzonService implements OnModuleInit, OnModuleDestroy {
  private readonly log = new Logger(SondeoBuzonService.name);
  private temporizador?: NodeJS.Timeout;
  private enCurso = false;

  constructor(
    private readonly config: ConfigService,
    private readonly ejecutor: EjecutorEmpresa,
    private readonly empresas: EmpresasService,
    private readonly recepcion: RecepcionService,
    private readonly buzon: BuzonService,
    @Inject(FABRICA_CORREO) private readonly fabrica: FabricaCorreo,
  ) {}

  /** ¿Está activado el sondeo automático? (variable `BUZON_CORREO_HABILITADO`; nunca en `NODE_ENV=test`). */
  habilitado(): boolean {
    if ((this.config.get<string>('NODE_ENV') ?? process.env.NODE_ENV) === 'test') return false;
    return String(this.config.get<string | boolean>('BUZON_CORREO_HABILITADO') ?? 'false') === 'true';
  }

  onModuleInit(): void {
    if (!this.habilitado()) return;
    const cadaSegundos = Number(this.config.get<string | number>('BUZON_CORREO_TICK_SEGUNDOS') ?? 30);
    this.temporizador = setInterval(() => void this.tick(), Math.max(5, cadaSegundos) * 1000);
    this.temporizador.unref();
    this.log.log(`Sondeo de buzones de correo activado (revisa cada ${cadaSegundos} s)`);
  }

  onModuleDestroy(): void {
    if (this.temporizador) clearInterval(this.temporizador);
  }

  /** Recorre los buzones activos que ya cumplieron su intervalo. Un buzón que falla no detiene a los demás. */
  async tick(ahora: Date = new Date()): Promise<void> {
    if (this.enCurso) return;
    this.enCurso = true;
    try {
      const buzones = await comoSistema(() =>
        this.ejecutor.ejecutar((em) =>
          em.getRepository(BuzonCorreo).find({ where: { activo: true }, relations: { empresa: true } }),
        ),
      );
      for (const b of buzones) {
        const vencido = !b.ultimoSondeoEn || ahora.getTime() - b.ultimoSondeoEn.getTime() >= b.intervaloSegundos * 1000;
        if (!vencido || !b.empresa) continue;
        const empresa = b.empresa;
        try {
          // El procesamiento corre con el alcance de esa sola empresa (RLS).
          await conContextoEmpresa({ todasLasEmpresas: false, ruts: [`${empresa.rut}-${empresa.dv}`] }, () =>
            this.sondear(empresa),
          );
        } catch (e) {
          this.log.warn(`Sondeo del buzón de ${empresa.rut}-${empresa.dv} falló: ${(e as Error).message}`);
        }
      }
    } catch (e) {
      this.log.error(`Fallo al listar los buzones: ${(e as Error).message}`);
    } finally {
      this.enCurso = false;
    }
  }

  /** Sondeo manual de la empresa (`POST /v1/empresas/:rut/buzon-correo/sondear`). */
  async sondearPorRut(rutEmpresa: string): Promise<ResumenSondeo> {
    const empresa = await this.empresas.obtenerPorRut(rutEmpresa);
    return this.sondear(empresa);
  }

  async sondear(empresa: Empresa): Promise<ResumenSondeo> {
    const cred = await this.buzon.credenciales(empresa.id);
    if (!cred) throw noEncontrado('El buzón de correo de la empresa', `${empresa.rut}-${empresa.dv}`);
    const resumen: ResumenSondeo = { mensajes: 0, adjuntos: 0, nuevos: 0, repetidos: 0, acusesEnviados: 0, errores: [] };
    let sesion: Awaited<ReturnType<FabricaCorreo['abrirImap']>> | undefined;
    try {
      sesion = await this.fabrica.abrirImap(cred.imap);
      const mensajes = await sesion.listarNoLeidos();
      resumen.mensajes = mensajes.length;
      for (const m of mensajes) {
        let fallo = false;
        for (const adjunto of m.adjuntos) {
          resumen.adjuntos++;
          try {
            const r = await this.recepcion.recibirParaEmpresa(empresa, adjunto.contenido, {
              origen: 'correo',
              remitente: m.remitente,
              nombreArchivo: adjunto.nombre,
            });
            if (r.repetido) {
              resumen.repetidos++;
              continue;
            }
            resumen.nuevos++;
            if (cred.smtp && m.remitente && r.envio.enlaces.recepcionEnvio) {
              try {
                await this.recepcion.enviarAcuse(empresa, r.envio.id, m.remitente);
                resumen.acusesEnviados++;
              } catch (e) {
                resumen.errores.push(`Acuse de ${adjunto.nombre} no enviado: ${(e as Error).message}`);
              }
            }
          } catch (e) {
            // Falla de infraestructura (p. ej. sin certificado): el mensaje queda sin leer para reintentarlo.
            fallo = true;
            resumen.errores.push(`${adjunto.nombre}: ${(e as Error).message}`);
          }
        }
        if (!fallo) await sesion.marcarProcesado(m.uid, m.adjuntos.length > 0 ? cred.buzon.carpetaProcesados : null);
      }
      await this.registrar(cred.buzon.id, resumen.errores.length > 0 ? resumen.errores.join(' | ').slice(0, 1000) : null);
      return resumen;
    } catch (e) {
      await this.registrar(cred.buzon.id, `Error de conexión o lectura: ${(e as Error).message}`.slice(0, 1000)).catch(
        () => undefined,
      );
      if (e instanceof ProblemaHttp) throw e;
      throw new ProblemaHttp(502, 'CORREO_NO_DISPONIBLE', 'No se pudo leer el buzón', `Falló la lectura del buzón IMAP: ${(e as Error).message}`);
    } finally {
      await sesion?.cerrar().catch(() => undefined);
    }
  }

  private async registrar(buzonId: string, error: string | null): Promise<void> {
    await this.ejecutor.ejecutar((em) =>
      em.update(BuzonCorreo, { id: buzonId }, { ultimoSondeoEn: new Date(), ultimoError: error }),
    );
  }
}
