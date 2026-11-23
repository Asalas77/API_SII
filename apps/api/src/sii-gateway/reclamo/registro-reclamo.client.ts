import { urlReclamo, type AmbienteSii } from '../ambientes.js';
import { SiiAutenticacionError, SiiError, SiiPeticionInvalidaError } from '../comun/errores.js';
import {
  normalizarRut,
  solicitar,
  type FetchImpl,
  type OpcionesReintento,
  type RutLike,
} from '../comun/http.js';
import { buscarClave, buscarTexto, comoArreglo, escaparXml, leerTextoXml, parsearXml } from '../comun/xml.js';

/**
 * Cliente SOAP del web service de Registro de Aceptación/Reclamo de DTE recibido (Ley 20.956),
 * "Web Service de Consulta y Registro de Aceptación/Reclamo a DTE recibido" v1.1 (16/03/2017). El PDF,
 * los WSDL y el XSD de la respuesta están en `docs/referencias-sii/registro-reclamo/`.
 *
 * Del WSDL (verificado): binding SOAP 1.1 `rpc/literal`, `soapAction=""`, namespace
 * `http://ws.registroreclamodte.diii.sdi.sii.cl`; todos los parámetros son `xs:string` y las respuestas
 * (salvo `consultarFechaRecepcionSii`, que devuelve un string) son `respuestaTo { codResp, descResp,
 * listaEventosDoc*, rutToken }`.
 *
 * SUPUESTOS no verificados contra el servicio real (no hay credenciales en este entorno):
 * - Autenticación: el PDF solo remite al flujo semilla/token de `autenticacion.pdf`; se envía el token
 *   del mismo flujo del DTE (CrSeed/GetTokenFromSeed) en `Cookie: TOKEN=...`, igual que en DTEUpload.
 * - El formato de `consultarFechaRecepcionSii` y de `fechaEvento` no está documentado: se espera
 *   `dd-mm-yyyy HH:MM:SS` (hora de Chile); `parsearFechaRecepcionSii` también tolera `dd/mm/yyyy` e ISO.
 * - `codResp` 0 es "Acción completada OK" (el PDF lista también un "1: Acción Completada OK" que choca con
 *   "1: Rut Emisor Erróneo"; se considera éxito el 1 solo si la descripción dice "completada").
 * - El servicio solo opera sobre 33, 34 y 43 (tipos citados en el PDF).
 */

export const ACCIONES_RECLAMO = {
  ACD: 'Acepta Contenido del Documento',
  RCD: 'Reclamo al Contenido del Documento',
  ERM: 'Otorga Recibo de Mercaderías o Servicios',
  RFP: 'Reclamo por Falta Parcial de Mercaderías',
  RFT: 'Reclamo por Falta Total de Mercaderías',
} as const;
export type AccionReclamo = keyof typeof ACCIONES_RECLAMO;

/** Tipos de documento que acepta el servicio (33, 34 y 43 según el PDF). */
export const TIPOS_RECLAMO_DTE: readonly number[] = [33, 34, 43];

const NS = 'http://ws.registroreclamodte.diii.sdi.sii.cl';

/** Lo que el cliente necesita del flujo de token (lo implementa `DteSiiClient`). */
export interface ProveedorTokenSii {
  obtenerToken(): Promise<string>;
  invalidarToken(): void;
}

export interface RegistroReclamoClientOpciones {
  ambiente: AmbienteSii;
  tokens: ProveedorTokenSii;
  fetchImpl?: FetchImpl;
  reintentos?: OpcionesReintento;
  /** Para pruebas: reemplaza la URL del ambiente. */
  url?: string;
}

/** Documento sobre el que se opera: la tripleta emisor, tipo y folio. */
export interface ReferenciaDocumentoReclamo {
  /** Cuerpo numérico del RUT del emisor del documento (sin DV). */
  rutEmisor: RutLike;
  dvEmisor: string;
  tipoDoc: number;
  folio: number;
}

export interface RespuestaRegistroReclamo {
  codigo: number;
  descripcion: string;
  /** El servicio completó la acción (o ya estaba registrada con la misma acción). */
  exito: boolean;
  rutToken?: string;
}

export interface EventoDocumento {
  codigo: string;
  descripcion: string;
  rutResponsable: string;
  dvResponsable: string;
  /** Texto tal cual lo informa el SII. */
  fechaTexto: string;
  /** `fechaTexto` interpretado como hora de Chile; `undefined` si no se pudo. */
  fecha?: Date;
}

export interface RespuestaEventos {
  /** 15 = listado de eventos; 16 = sin eventos; el resto son errores de negocio (8, 10, 14, 17, 18...). */
  codigo: number;
  descripcion: string;
  eventos: EventoDocumento[];
}

export interface RespuestaCedible {
  codigo: number;
  descripcion: string;
  /** 23 (cedible sin reclamos) y 25 (cedible, pasaron 8 días); el resto no es cedible o no hay datos. */
  cedible: boolean;
}

export interface RespuestaFechaRecepcion {
  /** Texto devuelto por el SII (vacío si el documento no existe). */
  texto: string;
  fecha?: Date;
}

const EXITO_COMPLETADA = /completad/i;

/* ---------------------------------------------------------------- fechas (hora de Chile) */

/** Desfase (minutos, negativo al oeste de UTC) de America/Santiago en el instante `utc`. */
function desfaseSantiagoMin(utc: Date): number {
  const nombre = new Intl.DateTimeFormat('en-US', { timeZone: 'America/Santiago', timeZoneName: 'shortOffset' })
    .formatToParts(utc)
    .find((p) => p.type === 'timeZoneName')?.value;
  const m = /GMT([+-])(\d{1,2})(?::(\d{2}))?/.exec(nombre ?? '');
  if (!m) return -180;
  const minutos = Number(m[2]) * 60 + Number(m[3] ?? 0);
  return m[1] === '-' ? -minutos : minutos;
}

function santiagoAUtc(a: number, mes: number, d: number, h: number, mi: number, s: number): Date {
  const referencia = Date.UTC(a, mes - 1, d, h, mi, s);
  let t = referencia - desfaseSantiagoMin(new Date(referencia)) * 60_000;
  const segundo = referencia - desfaseSantiagoMin(new Date(t)) * 60_000;
  if (segundo !== t) t = segundo;
  return new Date(t);
}

/**
 * Interpreta la fecha de recepción en el SII o de un evento. Acepta `dd-mm-yyyy[ HH:MM[:SS]]`,
 * `dd/mm/yyyy[...]` e ISO (`yyyy-mm-dd[THH:MM:SS[Z|±hh:mm]]`); sin zona se asume hora de Chile.
 */
export function parsearFechaRecepcionSii(texto: string | undefined): Date | undefined {
  const t = (texto ?? '').trim();
  if (!t) return undefined;
  const cl = /^(\d{1,2})[-/](\d{1,2})[-/](\d{4})(?:[ T](\d{1,2}):(\d{2})(?::(\d{2}))?)?$/.exec(t);
  if (cl) {
    return valida(santiagoAUtc(+cl[3], +cl[2], +cl[1], +(cl[4] ?? 0), +(cl[5] ?? 0), +(cl[6] ?? 0)), +cl[2]);
  }
  const iso = /^(\d{4})-(\d{2})-(\d{2})(?:[ T](\d{2}):(\d{2})(?::(\d{2}))?(?:\.\d+)?(Z|[+-]\d{2}:?\d{2})?)?$/.exec(t);
  if (iso) {
    if (iso[7]) return valida(new Date(t.replace(' ', 'T')), +iso[2]);
    return valida(santiagoAUtc(+iso[1], +iso[2], +iso[3], +(iso[4] ?? 0), +(iso[5] ?? 0), +(iso[6] ?? 0)), +iso[2]);
  }
  return undefined;
}

function valida(fecha: Date, mes: number): Date | undefined {
  return Number.isNaN(fecha.getTime()) || mes < 1 || mes > 12 ? undefined : fecha;
}

/* ---------------------------------------------------------------- cliente */

export class RegistroReclamoClient {
  private readonly ambiente: AmbienteSii;
  private readonly tokens: ProveedorTokenSii;
  private readonly fetchImpl: FetchImpl;
  private readonly reintentos?: OpcionesReintento;
  private readonly url: string;

  constructor(opciones: RegistroReclamoClientOpciones) {
    this.ambiente = opciones.ambiente;
    this.tokens = opciones.tokens;
    this.fetchImpl = opciones.fetchImpl ?? ((url, init) => globalThis.fetch(url, init));
    this.reintentos = opciones.reintentos;
    this.url = opciones.url ?? urlReclamo(this.ambiente);
  }

  /** `ingresarAceptacionReclamoDoc`: registra ACD, RCD, ERM, RFP o RFT sobre un DTE recibido. */
  async ingresarAceptacionReclamo(
    doc: ReferenciaDocumentoReclamo,
    accion: AccionReclamo,
  ): Promise<RespuestaRegistroReclamo> {
    if (!(accion in ACCIONES_RECLAMO)) {
      throw new SiiPeticionInvalidaError(`Acción inválida: ${String(accion)} (use ${Object.keys(ACCIONES_RECLAMO).join(', ')})`);
    }
    const r = await this.operacion('ingresarAceptacionReclamoDoc', { ...parametrosDoc(doc), accionDoc: accion });
    const base = respuestaBase(r);
    return {
      ...base,
      exito: base.codigo === 0 || (base.codigo === 1 && EXITO_COMPLETADA.test(base.descripcion)),
    };
  }

  /** `listarEventosHistDoc`: historial de eventos (aceptaciones, reclamos, recibos) del documento. */
  async listarEventos(doc: ReferenciaDocumentoReclamo): Promise<RespuestaEventos> {
    const r = await this.operacion('listarEventosHistDoc', parametrosDoc(doc));
    const base = respuestaBase(r);
    const eventos = comoArreglo<Record<string, unknown>>(buscarClave(r, 'listaEventosDoc')).map((e) => {
      const fechaTexto = campo(e, 'fechaEvento');
      return {
        codigo: campo(e, 'codEvento'),
        descripcion: campo(e, 'descEvento'),
        rutResponsable: campo(e, 'rutResponsable'),
        dvResponsable: campo(e, 'dvResponsable'),
        fechaTexto,
        fecha: parsearFechaRecepcionSii(fechaTexto),
      } satisfies EventoDocumento;
    });
    return { codigo: base.codigo, descripcion: base.descripcion, eventos };
  }

  /** `consultarDocDteCedible`: si el documento puede cederse (factoring). */
  async consultarDocDteCedible(doc: ReferenciaDocumentoReclamo): Promise<RespuestaCedible> {
    const base = respuestaBase(await this.operacion('consultarDocDteCedible', parametrosDoc(doc)));
    return { codigo: base.codigo, descripcion: base.descripcion, cedible: base.codigo === 23 || base.codigo === 25 };
  }

  /** `consultarFechaRecepcionSii`: fecha-hora en que el SII recibió el documento (inicio del plazo de 8 días). */
  async consultarFechaRecepcion(doc: ReferenciaDocumentoReclamo): Promise<RespuestaFechaRecepcion> {
    const doc2 = await this.operacion('consultarFechaRecepcionSii', parametrosDoc(doc));
    const texto = (buscarTexto(doc2, 'return') ?? '').trim();
    return { texto, fecha: parsearFechaRecepcionSii(texto) };
  }

  /** `getVersion`: versión del servicio (útil como prueba de conectividad; no requiere token en el PDF, se envía igual). */
  async obtenerVersion(): Promise<string> {
    return (buscarTexto(await this.operacion('getVersion', {}), 'return') ?? '').trim();
  }

  /* ------------------------------------------------------------ interno */

  private async operacion(nombre: string, parametros: Record<string, string>): Promise<Record<string, unknown>> {
    const ejecutar = async (token: string) => {
      const cuerpo = Object.entries(parametros)
        .map(([k, v]) => `<${k}>${escaparXml(v)}</${k}>`)
        .join('');
      const envelope =
        `<soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/" xmlns:ws="${NS}">` +
        `<soapenv:Header/><soapenv:Body><ws:${nombre}>${cuerpo}</ws:${nombre}></soapenv:Body></soapenv:Envelope>`;
      const resp = await solicitar(
        this.fetchImpl,
        this.url,
        {
          method: 'POST',
          headers: { 'Content-Type': 'text/xml; charset=utf-8', SOAPAction: '""', Cookie: `TOKEN=${token}` },
          body: envelope,
        },
        `Reclamo DTE: ${nombre}`,
        this.reintentos,
      );
      const xml = await leerTextoXml(resp);
      const doc = parsearXml(xml);
      const falla = buscarClave(doc, 'faultstring');
      if (falla !== undefined) {
        throw new SiiError(`Reclamo DTE: ${nombre}: SOAP Fault - ${JSON.stringify(falla)}`, { cuerpo: xml });
      }
      if (buscarClave(doc, 'return') === undefined && buscarClave(doc, `${nombre}Response`) === undefined) {
        throw new SiiError(`Reclamo DTE: ${nombre}: respuesta SOAP sin return`, { cuerpo: xml });
      }
      return doc;
    };
    const token = await this.tokens.obtenerToken();
    try {
      return await ejecutar(token);
    } catch (e) {
      if (!(e instanceof SiiAutenticacionError)) throw e;
      this.tokens.invalidarToken();
      return ejecutar(await this.tokens.obtenerToken());
    }
  }
}

function parametrosDoc(doc: ReferenciaDocumentoReclamo): Record<string, string> {
  const rut = normalizarRut(doc.rutEmisor);
  if (!/^\d{4,9}$/.test(rut)) throw new SiiPeticionInvalidaError(`rutEmisor inválido: ${rut}`);
  if (!/^[\dkK]$/.test(doc.dvEmisor)) throw new SiiPeticionInvalidaError(`dvEmisor inválido: ${doc.dvEmisor}`);
  if (!TIPOS_RECLAMO_DTE.includes(doc.tipoDoc)) {
    throw new SiiPeticionInvalidaError(
      `El servicio de reclamos solo opera sobre los tipos ${TIPOS_RECLAMO_DTE.join(', ')} (recibido ${doc.tipoDoc})`,
    );
  }
  if (!Number.isInteger(doc.folio) || doc.folio < 1) throw new SiiPeticionInvalidaError(`folio inválido: ${doc.folio}`);
  return {
    rutEmisor: rut,
    dvEmisor: doc.dvEmisor.toUpperCase(),
    tipoDoc: String(doc.tipoDoc),
    folio: String(doc.folio),
  };
}

function campo(o: Record<string, unknown>, k: string): string {
  const v = o[k];
  return v === undefined || v === null || typeof v === 'object' ? '' : String(v as string | number).trim();
}

function respuestaBase(doc: Record<string, unknown>): { codigo: number; descripcion: string; rutToken?: string } {
  const cod = buscarTexto(doc, 'codResp');
  const codigo = cod === undefined ? Number.NaN : Number(cod);
  if (!Number.isFinite(codigo)) {
    throw new SiiError('Reclamo DTE: respuesta sin codResp', { cuerpo: JSON.stringify(doc).slice(0, 500) });
  }
  return {
    codigo,
    descripcion: (buscarTexto(doc, 'descResp') ?? '').trim(),
    rutToken: buscarTexto(doc, 'rutToken'),
  };
}
