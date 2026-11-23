import { Injectable, Logger } from '@nestjs/common';
import { type FindOptionsSelect, type FindOptionsWhere, Raw } from 'typeorm';
import { type AccesoEmpresas, asegurarRecursoDeEmpresa } from '../auth/principal.js';
import { noEncontrado, ProblemaHttp } from '../comun/problema.js';
import { EjecutorEmpresa } from '../database/ejecutor-empresa.js';
import {
  aIso88591,
  ErrorValidacionDte,
  formatearRut,
  validarRut,
} from '../dte-core/index.js';
import type { Empresa } from '../empresas/entities/empresa.entity.js';
import { EmpresasService } from '../empresas/empresas.service.js';
import {
  analizarEnvioRecibido,
  construirRecepcionEnvio,
  EstadoRecepDte,
  EstadoRecepEnv,
} from '../intercambio/index.js';
import type { PdfQuery } from '../documentos/documentos.dto.js';
import { generarPdf } from '../representacion/index.js';
import { SiiClienteFactory } from '../sii/sii-cliente.factory.js';
import { BuzonService } from './correo/buzon.service.js';
import type { FiltroDteRecibidosQuery, PaginacionQuery } from './recepcion.dto.js';
import { DteRecibido, type EstadoComercialDte } from './entities/dte-recibido.entity.js';
import {
  EnvioRecibido,
  type OrigenEnvioRecibido,
  type ResumenDteEnvio,
} from './entities/envio-recibido.entity.js';
import { plazoDeReclamo } from './plazo.js';
import {
  datosDeDte,
  decodificarXml,
  extraerDtesDeSobre,
  fechaFirmaDeSobre,
  hashArchivo,
  rutEmisorDeCaratula,
} from './sobre.js';

export interface MetaEnvio {
  origen: OrigenEnvioRecibido;
  remitente?: string | null;
  nombreArchivo?: string | null;
}

export interface DteEnvioRespuesta extends ResumenDteEnvio {
  /** Id en `dte_recibidos` si el DTE se guardó (recibido OK). */
  dteRecibidoId: string | null;
  plazoReclamoHasta: Date | null;
}

export interface EnvioRecibidoRespuesta {
  id: string;
  empresa: string;
  origen: OrigenEnvioRecibido;
  remitente: string | null;
  nombreArchivo: string | null;
  hashSha256: string;
  codigoEnvio: number;
  rutEmisor: string | null;
  rutEnvia: string | null;
  fechaFirma: Date | null;
  estadoRecepcion: number;
  glosa: string;
  recibidoEn: Date;
  respuestaEnviadaEn: Date | null;
  /** `true` si ya se había recibido el mismo archivo (mismo SHA-256): no se duplica. */
  repetido: boolean;
  dtes: DteEnvioRespuesta[];
  enlaces: { xml: string; recepcionEnvio: string | null };
}

export interface ResultadoRecepcion {
  repetido: boolean;
  envio: EnvioRecibidoRespuesta;
}

export interface Pagina<T> {
  datos: T[];
  paginacion: { pagina: number; porPagina: number; total: number; paginas: number };
}

export interface DteRecibidoRespuesta {
  id: string;
  empresa: string;
  envioRecibidoId: string;
  tipoDte: number;
  folio: number;
  rutEmisor: string;
  razonSocialEmisor: string | null;
  fechaEmision: string;
  montoNeto: number | null;
  montoExento: number | null;
  iva: number | null;
  montoTotal: number;
  otrosImpuestos: Array<{ codigo: number; tasa: number; monto: number }> | null;
  estadoRecepcionDte: number;
  estadoComercial: EstadoComercialDte;
  glosa: string | null;
  respondidoEn: Date | null;
  plazoReclamoHasta: Date;
  plazoConfirmadoSii: boolean;
  plazoVencido: boolean;
  fechaRecepcionSii: Date | null;
  acuseReciboMercaderias: boolean;
  registroSii: DteRecibido['registroSii'];
  recibidoEn: Date;
  enlaces: { xml: string; pdf: string; resultadoDte: string | null; envioRecibos: string | null };
}

const CONSTRAINT_HASH = 'uq_envios_recibidos_hash';

function esViolacionUnica(e: unknown, constraint?: string): boolean {
  const d = (e as { driverError?: { code?: string; constraint?: string }; code?: string; constraint?: string }) ?? {};
  const code = d.driverError?.code ?? d.code;
  const nombre = d.driverError?.constraint ?? d.constraint;
  return code === '23505' && (constraint === undefined || nombre === constraint);
}

export function aRespuestaDteRecibido(d: DteRecibido, rutEmpresa: string, recibidoEn?: Date): DteRecibidoRespuesta {
  return {
    id: d.id,
    empresa: rutEmpresa,
    envioRecibidoId: d.envioRecibidoId,
    tipoDte: d.tipoDte,
    folio: d.folio,
    rutEmisor: formatearRut(d.rutEmisor, d.dvEmisor),
    razonSocialEmisor: d.razonSocialEmisor,
    fechaEmision: d.fechaEmision,
    montoNeto: d.montoNeto,
    montoExento: d.montoExento,
    iva: d.iva,
    montoTotal: d.montoTotal,
    otrosImpuestos: d.otrosImpuestos,
    estadoRecepcionDte: d.estadoRecepcionDte,
    estadoComercial: d.estadoComercial,
    glosa: d.glosa,
    respondidoEn: d.respondidoEn,
    plazoReclamoHasta: d.plazoReclamoHasta,
    plazoConfirmadoSii: d.plazoConfirmadoSii,
    plazoVencido: d.plazoReclamoHasta.getTime() < Date.now(),
    fechaRecepcionSii: d.fechaRecepcionSii,
    acuseReciboMercaderias: d.acuseReciboMercaderias,
    registroSii: d.registroSii,
    recibidoEn: recibidoEn ?? d.creadoEn,
    enlaces: {
      xml: `/v1/dte-recibidos/${d.id}/xml`,
      pdf: `/v1/dte-recibidos/${d.id}/pdf`,
      resultadoDte: d.respondidoEn && d.estadoComercial !== 'pendiente' ? `/v1/dte-recibidos/${d.id}/resultado-dte` : null,
      // El XML de los recibos solo viene cargado en el detalle; en los listados el enlace se omite.
      envioRecibos: d.xmlEnvioRecibos ? `/v1/dte-recibidos/${d.id}/envio-recibos` : null,
    },
  };
}

function paginar<T>(datos: T[], total: number, pagina: number, porPagina: number): Pagina<T> {
  return { datos, paginacion: { pagina, porPagina, total, paginas: Math.ceil(total / porPagina) } };
}

/**
 * Recepción de DTE de proveedores: analiza el `EnvioDTE`, lo guarda (XML original + hash), genera el acuse
 * `RecepcionEnvio` firmado con el certificado de la empresa y registra cada DTE recibido OK.
 */
@Injectable()
export class RecepcionService {
  private readonly log = new Logger(RecepcionService.name);

  constructor(
    private readonly ejecutor: EjecutorEmpresa,
    private readonly empresas: EmpresasService,
    private readonly sii: SiiClienteFactory,
    private readonly buzon: BuzonService,
  ) {}

  // -------------------------------------------------------------------------------------------
  // Ingreso
  // -------------------------------------------------------------------------------------------

  empresaPorRut(rut: string): Promise<Empresa> {
    return this.empresas.obtenerPorRut(rut);
  }

  async recibir(rutEmpresa: string, archivo: Buffer, meta: MetaEnvio): Promise<ResultadoRecepcion> {
    const empresa = await this.empresas.obtenerPorRut(rutEmpresa);
    return this.recibirParaEmpresa(empresa, archivo, meta);
  }

  /**
   * Procesa un archivo recibido. Si ya existe uno con el mismo SHA-256 devuelve el resultado previo sin
   * duplicar nada. Un sobre dirigido a otro receptor, con firma alterada o inválido se registra igual,
   * con el código de rechazo que corresponde, y se informa en el resultado.
   */
  async recibirParaEmpresa(empresa: Empresa, archivo: Buffer, meta: MetaEnvio): Promise<ResultadoRecepcion> {
    const hash = hashArchivo(archivo);
    const previo = await this.buscarPorHash(empresa.id, hash);
    if (previo) return { repetido: true, envio: await this.respuestaEnvio(previo, empresa, true) };

    // Sin certificado no se puede firmar el acuse: se falla antes de guardar nada (422).
    const certificado = await this.sii.certificadoActivo(empresa.id);
    const ahora = new Date();
    const texto = decodificarXml(archivo);
    const rutEmisorCaratula = rutEmisorDeCaratula(texto);
    const historial = await this.historialDtes(empresa.id, rutEmisorCaratula);
    const codigoEnvio = await this.siguiente('seq_codigo_envio_recibido');

    // No se pasa `historial.envios`: muchos emisores usan siempre `SetDoc` como ID del set y se rechazarían
    // todos sus envíos tras el primero. La deduplicación del archivo es por SHA-256 y la de cada DTE por
    // (emisor, tipo, folio).
    const analisis = analizarEnvioRecibido(
      archivo,
      { rut: empresa.rut, dv: empresa.dv },
      { dtes: historial },
      { nombreArchivo: meta.nombreArchivo ?? undefined, codigoEnvio, fechaRecepcion: ahora },
    );

    let xmlRecepcion: string | null = null;
    const rutRecibe = analisis.rutEmisor && validarRut(analisis.rutEmisor) ? analisis.rutEmisor : rutEmisorCaratula;
    try {
      xmlRecepcion = construirRecepcionEnvio(analisis, {
        idRespuesta: await this.siguiente('seq_id_respuesta_intercambio'),
        certificado,
        rutResponde: formatearRut(empresa.rut, empresa.dv),
        rutRecibe,
        nombreContacto: empresa.razonSocial,
        mailContacto: empresa.correoIntercambio ?? undefined,
        fechaFirma: ahora,
      }).xml;
    } catch (e) {
      if (!(e instanceof ErrorValidacionDte)) throw e;
      // Sin RUT emisor legible no hay a quién dirigir el acuse (archivo ilegible o inválido).
      this.log.warn(`No se generó el acuse del envío ${meta.nombreArchivo ?? ''}: ${e.message}`);
    }

    const dtesXml = extraerDtesDeSobre(texto);
    const resumen: ResumenDteEnvio[] = analisis.dtes.map((d) => ({
      indice: d.indice,
      tipoDte: d.tipoDte,
      folio: d.folio,
      fechaEmision: d.fechaEmision,
      rutEmisor: d.rutEmisor,
      rutReceptor: d.rutReceptor,
      montoTotal: d.montoTotal,
      estado: d.estado,
      glosa: d.glosa,
      errores: d.errores,
    }));

    let guardado: EnvioRecibido;
    try {
      guardado = await this.ejecutor.ejecutar(async (em) => {
        const envio = await em.save(
          em.create(EnvioRecibido, {
            empresaId: empresa.id,
            origen: meta.origen,
            remitente: meta.remitente?.slice(0, 254) ?? null,
            nombreArchivo: meta.nombreArchivo?.slice(0, 200) ?? null,
            xml: archivo,
            hashSha256: hash,
            codigoEnvio,
            rutEmisor: analisis.rutEmisor ?? rutRecibe ?? null,
            rutEnvia: analisis.rutEnvia ?? null,
            fechaFirma: fechaFirmaDeSobre(texto) ?? null,
            estadoRecepcion: analisis.estado,
            glosa: analisis.glosa.slice(0, 300),
            xmlRecepcionEnvio: xmlRecepcion,
            resumenDtes: resumen,
            respuestaEnviadaEn: null,
            recibidoEn: ahora,
          }),
        );
        if (analisis.estado === EstadoRecepEnv.OK) {
          const plazo = plazoDeReclamo(ahora);
          for (const d of analisis.dtes) {
            const xmlDte = dtesXml.length === analisis.dtes.length ? dtesXml[d.indice] : undefined;
            if (d.estado !== EstadoRecepDte.OK || !xmlDte) continue;
            const [numero, dv] = d.rutEmisor.split('-');
            const extra = datosDeDte(xmlDte);
            await em.save(
              em.create(DteRecibido, {
                empresaId: empresa.id,
                envioRecibidoId: envio.id,
                indice: d.indice,
                tipoDte: d.tipoDte,
                folio: d.folio,
                rutEmisor: Number(numero),
                dvEmisor: dv,
                razonSocialEmisor: extra.razonSocialEmisor?.slice(0, 100) ?? null,
                fechaEmision: d.fechaEmision,
                montoNeto: extra.montoNeto ?? null,
                montoExento: extra.montoExento ?? null,
                iva: extra.iva ?? null,
                montoTotal: d.montoTotal,
                otrosImpuestos: extra.otrosImpuestos.length > 0 ? extra.otrosImpuestos : null,
                xml: xmlDte,
                estadoRecepcionDte: d.estado,
                estadoComercial: 'pendiente',
                glosa: null,
                respondidoEn: null,
                xmlResultadoDte: null,
                xmlEnvioRecibos: null,
                plazoReclamoHasta: plazo.hasta,
                plazoConfirmadoSii: plazo.confirmadoSii,
                fechaRecepcionSii: null,
                acuseReciboMercaderias: false,
                registroSii: null,
              }),
            );
          }
        }
        return envio;
      });
    } catch (e) {
      if (esViolacionUnica(e, CONSTRAINT_HASH)) {
        // Carrera: otro proceso guardó el mismo archivo entre la búsqueda y el INSERT.
        const otro = await this.buscarPorHash(empresa.id, hash);
        if (otro) return { repetido: true, envio: await this.respuestaEnvio(otro, empresa, true) };
      }
      throw e;
    }
    return { repetido: false, envio: await this.respuestaEnvio(guardado, empresa, false) };
  }

  /** Marca el acuse como enviado por correo (fecha). */
  async marcarRespuestaEnviada(envioId: string): Promise<void> {
    await this.ejecutor.ejecutar((em) =>
      em.update(EnvioRecibido, { id: envioId }, { respuestaEnviadaEn: new Date() }),
    );
  }

  /** Envía por SMTP el acuse `RecepcionEnvio` de un envío recibido. */
  async enviarAcuse(empresa: Empresa, envioId: string, destinatario: string): Promise<void> {
    const envio = await this.ejecutor.ejecutar((em) =>
      em.getRepository(EnvioRecibido).findOne({ where: { id: envioId, empresaId: empresa.id } }),
    );
    if (!envio?.xmlRecepcionEnvio) {
      throw new ProblemaHttp(409, 'ESTADO_INVALIDO', 'Sin acuse', 'El envío no tiene un acuse RecepcionEnvio generado');
    }
    await this.buzon.enviar(empresa, {
      para: destinatario,
      asunto: `Acuse de recibo de envío DTE ${envio.nombreArchivo ?? envio.codigoEnvio}`,
      texto: `Se adjunta el acuse de recibo (RecepcionEnvio) del envío de DTE ${envio.nombreArchivo ?? ''}. ${envio.glosa}`,
      adjuntos: [
        {
          nombre: `RecepcionEnvio_${envio.codigoEnvio}.xml`,
          tipo: 'application/xml',
          contenido: aIso88591(envio.xmlRecepcionEnvio),
        },
      ],
    });
    await this.marcarRespuestaEnviada(envio.id);
  }

  // -------------------------------------------------------------------------------------------
  // Consulta
  // -------------------------------------------------------------------------------------------

  async listarEnvios(rutEmpresa: string, q: PaginacionQuery): Promise<Pagina<EnvioRecibidoRespuesta>> {
    const empresa = await this.empresas.obtenerPorRut(rutEmpresa);
    const pagina = q.pagina ?? 1;
    const porPagina = q.porPagina ?? 50;
    const [filas, total] = await this.ejecutor.ejecutar((em) =>
      em.getRepository(EnvioRecibido).findAndCount({
        where: { empresaId: empresa.id },
        // No se carga el XML original (puede pesar MB); se baja por /xml.
        select: columnasEnvioSinXml(),
        order: { recibidoEn: 'DESC', creadoEn: 'DESC' },
        skip: (pagina - 1) * porPagina,
        take: porPagina,
      }),
    );
    const respuestas = await Promise.all(filas.map((f) => this.respuestaEnvio(f, empresa, false)));
    return paginar(respuestas, total, pagina, porPagina);
  }

  /** Envío por id restringido al acceso del principal: uno ajeno responde 404. */
  async obtenerEnvio(id: string, acceso: AccesoEmpresas, conXml = false): Promise<{ envio: EnvioRecibido; empresa: Empresa }> {
    const envio = await this.ejecutor.ejecutar((em) =>
      em.getRepository(EnvioRecibido).findOne({ where: { id }, ...(conXml ? {} : { select: columnasEnvioSinXml() }) }),
    );
    if (!envio) throw noEncontrado('El envío recibido', id);
    // RLS ya oculta las filas de empresas fuera del alcance de la key; esta es la segunda barrera.
    const empresa = await this.empresas.obtenerPorId(envio.empresaId);
    asegurarRecursoDeEmpresa(acceso, `${empresa.rut}-${empresa.dv}`, 'El envío recibido', id);
    return { envio, empresa };
  }

  async detalleEnvio(id: string, acceso: AccesoEmpresas): Promise<EnvioRecibidoRespuesta> {
    const { envio, empresa } = await this.obtenerEnvio(id, acceso);
    return this.respuestaEnvio(envio, empresa, false);
  }

  async xmlEnvio(id: string, acceso: AccesoEmpresas): Promise<{ buffer: Buffer; nombre: string }> {
    const { envio } = await this.obtenerEnvio(id, acceso, true);
    return { buffer: envio.xml, nombre: envio.nombreArchivo ?? `EnvioDTE_${envio.codigoEnvio}.xml` };
  }

  async xmlRecepcionEnvio(id: string, acceso: AccesoEmpresas): Promise<{ buffer: Buffer; nombre: string }> {
    const { envio } = await this.obtenerEnvio(id, acceso);
    if (!envio.xmlRecepcionEnvio) throw noEncontrado('El acuse RecepcionEnvio del envío', id);
    return { buffer: aIso88591(envio.xmlRecepcionEnvio), nombre: `RecepcionEnvio_${envio.codigoEnvio}.xml` };
  }

  async listarDtes(rutEmpresa: string, q: FiltroDteRecibidosQuery): Promise<Pagina<DteRecibidoRespuesta>> {
    const empresa = await this.empresas.obtenerPorRut(rutEmpresa);
    const pagina = q.pagina ?? 1;
    const porPagina = q.porPagina ?? 50;
    const donde: FindOptionsWhere<DteRecibido> = { empresaId: empresa.id };
    if (q.estado) donde.estadoComercial = q.estado;
    if (q.periodo) {
      // Rango [primer día, primer día del mes siguiente) sobre la fecha de emisión.
      const [a, m] = q.periodo.split('-').map(Number);
      const siguiente = m === 12 ? `${a + 1}-01-01` : `${a}-${String(m + 1).padStart(2, '0')}-01`;
      donde.fechaEmision = Raw((alias) => `${alias} >= :desde AND ${alias} < :hasta`, {
        desde: `${q.periodo}-01`,
        hasta: siguiente,
      });
    }
    if (q.rutEmisor) donde.rutEmisor = Number(q.rutEmisor.split('-')[0]);
    const [filas, total] = await this.ejecutor.ejecutar((em) =>
      em.getRepository(DteRecibido).findAndCount({
        where: donde,
        // El XML y las respuestas pesan; se bajan por sus endpoints.
        select: columnasDteSinXml(),
        order: { fechaEmision: 'DESC', folio: 'DESC' },
        skip: (pagina - 1) * porPagina,
        take: porPagina,
      }),
    );
    const rut = `${empresa.rut}-${empresa.dv}`;
    return paginar(
      filas.map((f) => aRespuestaDteRecibido(f, rut)),
      total,
      pagina,
      porPagina,
    );
  }

  /** DTE recibido por id restringido al acceso del principal: uno ajeno responde 404. */
  async obtenerDte(id: string, acceso: AccesoEmpresas): Promise<{ dte: DteRecibido; empresa: Empresa }> {
    const dte = await this.ejecutor.ejecutar((em) =>
      em.getRepository(DteRecibido).findOne({ where: { id }, relations: { empresa: true } }),
    );
    if (!dte?.empresa) throw noEncontrado('El DTE recibido', id);
    asegurarRecursoDeEmpresa(acceso, `${dte.empresa.rut}-${dte.empresa.dv}`, 'El DTE recibido', id);
    return { dte, empresa: dte.empresa };
  }

  async detalleDte(id: string, acceso: AccesoEmpresas): Promise<DteRecibidoRespuesta> {
    const { dte, empresa } = await this.obtenerDte(id, acceso);
    return aRespuestaDteRecibido(dte, `${empresa.rut}-${empresa.dv}`);
  }

  async xmlDte(id: string, acceso: AccesoEmpresas): Promise<{ buffer: Buffer; nombre: string }> {
    const { dte } = await this.obtenerDte(id, acceso);
    return { buffer: aIso88591(dte.xml), nombre: `DTE_${dte.tipoDte}_${dte.folio}_${dte.rutEmisor}.xml` };
  }

  /**
   * Representación impresa del DTE recibido (mismo generador que los emitidos). La resolución que se imprime
   * es la de la carátula del sobre; sin ella, `Res. 0 de <año de emisión>`. Sin logo ni unidad SII (son del emisor).
   */
  async pdfDte(id: string, opciones: PdfQuery, acceso: AccesoEmpresas): Promise<{ buffer: Buffer; nombre: string }> {
    const { dte } = await this.obtenerDte(id, acceso);
    const envio = await this.ejecutor.ejecutar((em) =>
      em.getRepository(EnvioRecibido).findOne({ where: { id: dte.envioRecibidoId }, select: { id: true, xml: true } }),
    );
    const caratula = /<Caratula[\s\S]*?<\/Caratula>/.exec(envio ? decodificarXml(envio.xml) : '')?.[0] ?? '';
    const numero = Number(/<NroResol>(\d+)<\/NroResol>/.exec(caratula)?.[1] ?? 0);
    const fecha = /<FchResol>(\d{4}-\d{2}-\d{2})<\/FchResol>/.exec(caratula)?.[1] ?? dte.fechaEmision;
    let buffer: Buffer;
    try {
      buffer = await generarPdf(dte.xml, {
        formato: opciones.formato,
        cedible: opciones.cedible,
        resolucion: { numero, fecha },
      });
    } catch (e) {
      throw new ProblemaHttp(
        422,
        'PDF_NO_DISPONIBLE',
        'No se pudo generar el PDF',
        `El DTE recibido (tipo ${dte.tipoDte}) no se puede imprimir: ${(e as Error).message}`,
      );
    }
    return { buffer, nombre: `DTE_${dte.tipoDte}_${dte.folio}_${dte.rutEmisor}.pdf` };
  }

  // -------------------------------------------------------------------------------------------
  // Internos
  // -------------------------------------------------------------------------------------------

  private async siguiente(secuencia: 'seq_codigo_envio_recibido' | 'seq_id_respuesta_intercambio'): Promise<number> {
    const filas = await this.ejecutor.ejecutar((em) =>
      em.query<Array<{ n: number }>>(`SELECT nextval('${secuencia}')::int AS n`),
    );
    return Number(filas[0].n);
  }

  private buscarPorHash(empresaId: string, hash: string): Promise<EnvioRecibido | null> {
    return this.ejecutor.ejecutar((em) =>
      em.getRepository(EnvioRecibido).findOne({
        where: { empresaId, hashSha256: hash },
        select: columnasEnvioSinXml(),
      }),
    );
  }

  private async historialDtes(
    empresaId: string,
    rutEmisor: string | undefined,
  ): Promise<Array<{ rutEmisor: string; tipoDte: number; folio: number }>> {
    const numero = rutEmisor ? Number.parseInt(rutEmisor, 10) : Number.NaN;
    if (!Number.isFinite(numero)) return [];
    const filas = await this.ejecutor.ejecutar((em) =>
      em.getRepository(DteRecibido).find({
        where: { empresaId, rutEmisor: numero },
        select: { tipoDte: true, folio: true, rutEmisor: true, dvEmisor: true },
      }),
    );
    return filas.map((f) => ({ rutEmisor: formatearRut(f.rutEmisor, f.dvEmisor), tipoDte: f.tipoDte, folio: f.folio }));
  }

  private async respuestaEnvio(e: EnvioRecibido, empresa: Empresa, repetido: boolean): Promise<EnvioRecibidoRespuesta> {
    const guardados = await this.ejecutor.ejecutar((em) =>
      em.getRepository(DteRecibido).find({
        where: { envioRecibidoId: e.id },
        select: { id: true, tipoDte: true, folio: true, plazoReclamoHasta: true },
      }),
    );
    const porClave = new Map(guardados.map((g) => [`${g.tipoDte}|${g.folio}`, g]));
    return {
      id: e.id,
      empresa: `${empresa.rut}-${empresa.dv}`,
      origen: e.origen,
      remitente: e.remitente,
      nombreArchivo: e.nombreArchivo,
      hashSha256: e.hashSha256,
      codigoEnvio: e.codigoEnvio,
      rutEmisor: e.rutEmisor,
      rutEnvia: e.rutEnvia,
      fechaFirma: e.fechaFirma,
      estadoRecepcion: e.estadoRecepcion,
      glosa: e.glosa,
      recibidoEn: e.recibidoEn,
      respuestaEnviadaEn: e.respuestaEnviadaEn,
      repetido,
      dtes: (e.resumenDtes ?? []).map((d) => {
        const g = d.estado === EstadoRecepDte.OK ? porClave.get(`${d.tipoDte}|${d.folio}`) : undefined;
        return { ...d, dteRecibidoId: g?.id ?? null, plazoReclamoHasta: g?.plazoReclamoHasta ?? null };
      }),
      enlaces: {
        xml: `/v1/envios-recibidos/${e.id}/xml`,
        recepcionEnvio: e.xmlRecepcionEnvio !== null ? `/v1/envios-recibidos/${e.id}/recepcion-envio` : null,
      },
    };
  }
}

/** Todas las columnas de `envios_recibidos` salvo el XML original. */
function columnasEnvioSinXml(): FindOptionsSelect<EnvioRecibido> {
  return {
    id: true,
    empresaId: true,
    origen: true,
    remitente: true,
    nombreArchivo: true,
    hashSha256: true,
    codigoEnvio: true,
    rutEmisor: true,
    rutEnvia: true,
    fechaFirma: true,
    estadoRecepcion: true,
    glosa: true,
    xmlRecepcionEnvio: true,
    resumenDtes: true,
    respuestaEnviadaEn: true,
    recibidoEn: true,
    creadoEn: true,
  };
}

/** Columnas de `dte_recibidos` sin XML del DTE ni XML de las respuestas, pero con indicadores. */
function columnasDteSinXml(): FindOptionsSelect<DteRecibido> {
  return {
    id: true,
    empresaId: true,
    envioRecibidoId: true,
    indice: true,
    tipoDte: true,
    folio: true,
    rutEmisor: true,
    dvEmisor: true,
    razonSocialEmisor: true,
    fechaEmision: true,
    montoNeto: true,
    montoExento: true,
    iva: true,
    montoTotal: true,
    otrosImpuestos: true,
    estadoRecepcionDte: true,
    estadoComercial: true,
    glosa: true,
    respondidoEn: true,
    plazoReclamoHasta: true,
    plazoConfirmadoSii: true,
    fechaRecepcionSii: true,
    acuseReciboMercaderias: true,
    registroSii: true,
    creadoEn: true,
    actualizadoEn: true,
  };
}
