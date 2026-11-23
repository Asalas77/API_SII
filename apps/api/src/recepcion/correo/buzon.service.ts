import { Inject, Injectable } from '@nestjs/common';
import { noEncontrado, ProblemaHttp } from '../../comun/problema.js';
import { EjecutorEmpresa } from '../../database/ejecutor-empresa.js';
import type { Empresa } from '../../empresas/entities/empresa.entity.js';
import { EmpresasService } from '../../empresas/empresas.service.js';
import { CifradoService } from '../../seguridad/cifrado.service.js';
import type { ConfigurarBuzonDto } from '../recepcion.dto.js';
import { BuzonCorreo } from '../entities/buzon-correo.entity.js';
import {
  FABRICA_CORREO,
  type ConfigImap,
  type ConfigSmtp,
  type FabricaCorreo,
  type MensajeSaliente,
} from './tipos.js';

export interface BuzonRespuesta {
  id: string;
  empresa: string;
  activo: boolean;
  imapHost: string;
  imapPuerto: number;
  imapSeguro: boolean;
  usuario: string;
  /** La contraseña nunca se devuelve. */
  tienePassword: true;
  carpeta: string;
  carpetaProcesados: string | null;
  smtpHost: string | null;
  smtpPuerto: number | null;
  smtpSeguro: boolean;
  smtpUsuario: string | null;
  tieneSmtpPassword: boolean;
  smtpRemitente: string | null;
  intervaloSegundos: number;
  ultimoSondeoEn: Date | null;
  ultimoError: string | null;
  creadoEn: Date;
  actualizadoEn: Date;
}

export function aRespuestaBuzon(b: BuzonCorreo, rutEmpresa: string, tieneSmtpPassword: boolean): BuzonRespuesta {
  return {
    id: b.id,
    empresa: rutEmpresa,
    activo: b.activo,
    imapHost: b.imapHost,
    imapPuerto: b.imapPuerto,
    imapSeguro: b.imapSeguro,
    usuario: b.usuario,
    tienePassword: true,
    carpeta: b.carpeta,
    carpetaProcesados: b.carpetaProcesados,
    smtpHost: b.smtpHost,
    smtpPuerto: b.smtpPuerto,
    smtpSeguro: b.smtpSeguro,
    smtpUsuario: b.smtpUsuario,
    tieneSmtpPassword,
    smtpRemitente: b.smtpRemitente,
    intervaloSegundos: b.intervaloSegundos,
    ultimoSondeoEn: b.ultimoSondeoEn,
    ultimoError: b.ultimoError,
    creadoEn: b.creadoEn,
    actualizadoEn: b.actualizadoEn,
  };
}

/** Configuración del buzón de intercambio (IMAP/SMTP) y envío de las respuestas por SMTP. */
@Injectable()
export class BuzonService {
  constructor(
    private readonly ejecutor: EjecutorEmpresa,
    private readonly empresas: EmpresasService,
    private readonly cifrado: CifradoService,
    @Inject(FABRICA_CORREO) private readonly correo: FabricaCorreo,
  ) {}

  /** Buzón de la empresa sin credenciales, o `null`. */
  async buscar(empresaId: string): Promise<BuzonCorreo | null> {
    return this.ejecutor.ejecutar((em) => em.getRepository(BuzonCorreo).findOne({ where: { empresaId } }));
  }

  async obtener(rutEmpresa: string): Promise<BuzonRespuesta> {
    const empresa = await this.empresas.obtenerPorRut(rutEmpresa);
    const buzon = await this.conSmtp(empresa.id);
    if (!buzon) throw noEncontrado('El buzón de correo de la empresa', rutEmpresa);
    return aRespuestaBuzon(buzon.buzon, `${empresa.rut}-${empresa.dv}`, buzon.tieneSmtpPassword);
  }

  /** Crea o actualiza el buzón. La contraseña es obligatoria al crear; después, omitirla la conserva. */
  async guardar(rutEmpresa: string, dto: ConfigurarBuzonDto): Promise<{ buzon: BuzonRespuesta; creado: boolean }> {
    const empresa = await this.empresas.obtenerPorRut(rutEmpresa);
    const existente = await this.conSmtp(empresa.id);
    if (!existente && !dto.password) {
      throw new ProblemaHttp(400, 'VALIDACION', 'Falta la contraseña', 'password es obligatoria al crear el buzón', [
        { campo: 'password', mensaje: 'es obligatoria al crear el buzón' },
      ]);
    }
    const valores: Partial<BuzonCorreo> = {
      ...(dto.activo !== undefined ? { activo: dto.activo } : {}),
      imapHost: dto.imapHost,
      ...(dto.imapPuerto !== undefined ? { imapPuerto: dto.imapPuerto } : {}),
      ...(dto.imapSeguro !== undefined ? { imapSeguro: dto.imapSeguro } : {}),
      usuario: dto.usuario,
      ...(dto.password ? { passwordCifrada: this.cifrado.cifrar(Buffer.from(dto.password, 'utf8')) } : {}),
      ...(dto.carpeta !== undefined ? { carpeta: dto.carpeta } : {}),
      ...(dto.carpetaProcesados !== undefined ? { carpetaProcesados: dto.carpetaProcesados } : {}),
      ...(dto.smtpHost !== undefined ? { smtpHost: dto.smtpHost } : {}),
      ...(dto.smtpPuerto !== undefined ? { smtpPuerto: dto.smtpPuerto } : {}),
      ...(dto.smtpSeguro !== undefined ? { smtpSeguro: dto.smtpSeguro } : {}),
      ...(dto.smtpUsuario !== undefined ? { smtpUsuario: dto.smtpUsuario } : {}),
      ...(dto.smtpPassword !== undefined
        ? { smtpPasswordCifrada: dto.smtpPassword ? this.cifrado.cifrar(Buffer.from(dto.smtpPassword, 'utf8')) : null }
        : {}),
      ...(dto.smtpRemitente !== undefined ? { smtpRemitente: dto.smtpRemitente } : {}),
      ...(dto.intervaloSegundos !== undefined ? { intervaloSegundos: dto.intervaloSegundos } : {}),
    };
    await this.ejecutor.ejecutar(async (em) => {
      if (existente) await em.update(BuzonCorreo, { id: existente.buzon.id }, valores);
      else await em.save(em.create(BuzonCorreo, { ...valores, empresaId: empresa.id }));
    });
    return { buzon: await this.obtener(rutEmpresa), creado: !existente };
  }

  async eliminar(rutEmpresa: string): Promise<void> {
    const empresa = await this.empresas.obtenerPorRut(rutEmpresa);
    const r = await this.ejecutor.ejecutar((em) => em.delete(BuzonCorreo, { empresaId: empresa.id }));
    if (!r.affected) throw noEncontrado('El buzón de correo de la empresa', rutEmpresa);
  }

  /** Credenciales descifradas (solo en memoria) para IMAP y, si está configurado, SMTP. */
  async credenciales(empresaId: string): Promise<{ buzon: BuzonCorreo; imap: ConfigImap; smtp: ConfigSmtp | null } | null> {
    const fila = await this.conSecretos(empresaId);
    if (!fila) return null;
    const password = this.cifrado.descifrar(fila.passwordCifrada).toString('utf8');
    const smtpPassword = fila.smtpPasswordCifrada
      ? this.cifrado.descifrar(fila.smtpPasswordCifrada).toString('utf8')
      : password;
    const smtp: ConfigSmtp | null =
      fila.smtpHost && fila.smtpPuerto
        ? {
            host: fila.smtpHost,
            puerto: fila.smtpPuerto,
            seguro: fila.smtpSeguro,
            usuario: fila.smtpUsuario ?? fila.usuario,
            password: smtpPassword,
            remitente: fila.smtpRemitente ?? (fila.usuario.includes('@') ? fila.usuario : ''),
          }
        : null;
    return {
      buzon: fila,
      imap: {
        host: fila.imapHost,
        puerto: fila.imapPuerto,
        seguro: fila.imapSeguro,
        usuario: fila.usuario,
        password,
        carpeta: fila.carpeta,
      },
      smtp,
    };
  }

  /**
   * Envía un correo con el SMTP del buzón de la empresa. 422 si no hay buzón o SMTP configurado.
   * El remitente (`From`) es `smtpRemitente`, o el correo de intercambio de la empresa, o el usuario.
   */
  async enviar(empresa: Empresa, mensaje: MensajeSaliente): Promise<void> {
    const cred = await this.credenciales(empresa.id);
    if (!cred?.smtp) {
      throw new ProblemaHttp(
        422,
        'SMTP_NO_CONFIGURADO',
        'Sin SMTP',
        'La empresa no tiene un buzón con SMTP configurado; use PUT /v1/empresas/{rut}/buzon-correo (smtpHost, smtpPuerto) o envíe el XML descargado por su cuenta',
      );
    }
    const remitente = cred.buzon.smtpRemitente ?? empresa.correoIntercambio ?? cred.smtp.remitente;
    if (!remitente) {
      throw new ProblemaHttp(422, 'SMTP_NO_CONFIGURADO', 'Sin remitente', 'Configure smtpRemitente en el buzón de correo');
    }
    try {
      await this.correo.enviar({ ...cred.smtp, remitente }, mensaje);
    } catch (e) {
      throw new ProblemaHttp(502, 'CORREO_NO_ENVIADO', 'No se pudo enviar el correo', `Falló el envío por SMTP: ${(e as Error).message}`);
    }
  }

  private async conSmtp(empresaId: string): Promise<{ buzon: BuzonCorreo; tieneSmtpPassword: boolean } | null> {
    const fila = await this.conSecretos(empresaId);
    if (!fila) return null;
    return { buzon: fila, tieneSmtpPassword: fila.smtpPasswordCifrada !== null };
  }

  private async conSecretos(empresaId: string): Promise<BuzonCorreo | null> {
    return this.ejecutor.ejecutar((em) =>
      em
        .getRepository(BuzonCorreo)
        .createQueryBuilder('b')
        .addSelect(['b.passwordCifrada', 'b.smtpPasswordCifrada'])
        .where('b.empresaId = :empresaId', { empresaId })
        .getOne(),
    );
  }
}
