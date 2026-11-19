import {
  aIso88591,
  ErrorValidacionDte,
  escaparXml,
  firmarXml,
  formatearTimestampSii,
  sanearLatin1,
  validarRut,
} from '../dte-core/index.js';
import {
  GLOSA_ESTADO_DTE,
  type EstadoDteCodigo,
} from './estados.js';
import type { AnalisisDte, AnalisisEnvio } from './recepcion.js';

export const NS_SII = 'http://www.sii.cl/SiiDte';
const NS_XSI = 'http://www.w3.org/2001/XMLSchema-instance';

/** Certificado y clave privada de quien firma la respuesta (PEM). */
export interface CertificadoFirma {
  certificadoPem: string;
  clavePrivadaPem: string;
}

export interface DatosRespuesta {
  /** `IdRespuesta`: número único (entero positivo, máx. 10 dígitos) asignado por quien responde. */
  idRespuesta: number;
  certificado: CertificadoFirma;
  /** `RutResponde` (`12345678-5`). Por defecto, el receptor del análisis. Obligatorio en `ResultadoDTE`. */
  rutResponde?: string;
  /** `RutRecibe` (`12345678-5`): el emisor de los DTE. Por defecto, el RUT emisor del análisis. */
  rutRecibe?: string;
  nombreContacto?: string;
  fonoContacto?: string;
  mailContacto?: string;
  /** `TmstFirmaResp`. Por defecto, ahora. */
  fechaFirma?: Date;
  /** Atributo `ID` de `Resultado` (el elemento firmado). Por defecto `Resultado`. */
  idResultado?: string;
}

/** Resultado de la aprobación comercial de un DTE (`ResultadoDTE`). */
export interface ResultadoComercialDte {
  tipoDte: number;
  folio: number;
  /** `yyyy-mm-dd`. */
  fechaEmision: string;
  rutEmisor: string;
  rutReceptor: string;
  montoTotal: number;
  /** `CodEnvio` del envío en que se recibió el DTE (el mismo de `RecepcionEnvio`). */
  codigoEnvio: number;
  estado: EstadoDteCodigo;
  /** `EstadoDTEGlosa` (máx. 256). Por defecto, la glosa del estado. Si se rechaza (Ley 19.983) indique el motivo. */
  glosa?: string;
  /** `CodRchDsc`: entero negativo de hasta 3 dígitos (motivo de rechazo o discrepancia). */
  codigoRechazo?: number;
}

export interface RespuestaConstruida {
  /** `RespuestaDTE` firmado, sin declaración XML. */
  xml: string;
  /** Mismo XML con declaración ISO-8859-1, codificado en Latin-1 (lo que se envía). */
  xmlIso: Buffer;
}

function texto(valor: string, max: number): string {
  return escaparXml(Array.from(sanearLatin1(valor).trim()).slice(0, max).join(''));
}

function rutValido(rut: string | undefined, campo: string): string {
  const r = (rut ?? '').replace(/\./g, '').trim().toUpperCase();
  if (!validarRut(r)) throw new ErrorValidacionDte(`${campo}: RUT inválido (${rut ?? 'ausente'})`);
  return r;
}

function enteroPositivo(valor: number, campo: string, digitos: number): number {
  if (!Number.isInteger(valor) || valor < 1 || String(valor).length > digitos) {
    throw new ErrorValidacionDte(`${campo} debe ser un entero positivo de hasta ${digitos} dígitos (recibido ${valor})`);
  }
  return valor;
}

function caratula(datos: DatosRespuesta, rutResponde: string, rutRecibe: string, nroDetalles: number): string {
  const ts = formatearTimestampSii(datos.fechaFirma ?? new Date());
  return (
    '<Caratula version="1.0">' +
    `<RutResponde>${rutResponde}</RutResponde>` +
    `<RutRecibe>${rutRecibe}</RutRecibe>` +
    `<IdRespuesta>${enteroPositivo(datos.idRespuesta, 'idRespuesta', 10)}</IdRespuesta>` +
    `<NroDetalles>${enteroPositivo(nroDetalles, 'NroDetalles', 4)}</NroDetalles>` +
    (datos.nombreContacto ? `<NmbContacto>${texto(datos.nombreContacto, 40)}</NmbContacto>` : '') +
    (datos.fonoContacto ? `<FonoContacto>${texto(datos.fonoContacto, 40)}</FonoContacto>` : '') +
    (datos.mailContacto ? `<MailContacto>${texto(datos.mailContacto, 80)}</MailContacto>` : '') +
    `<TmstFirmaResp>${ts}</TmstFirmaResp>` +
    '</Caratula>'
  );
}

function envolverYFirmar(cuerpo: string, datos: DatosRespuesta): RespuestaConstruida {
  const id = datos.idResultado ?? 'Resultado';
  const sobre =
    `<RespuestaDTE xmlns="${NS_SII}" xmlns:xsi="${NS_XSI}" xsi:schemaLocation="${NS_SII} RespuestaEnvioDTE_v10.xsd" version="1.0">` +
    `<Resultado ID="${id}">${cuerpo}</Resultado>` +
    '</RespuestaDTE>';
  const xml = firmarXml(sobre, { ...datos.certificado, idReferencia: id });
  return { xml, xmlIso: aIso88591(xml) };
}

function recepcionDte(d: AnalisisDte): string {
  return (
    '<RecepcionDTE>' +
    `<TipoDTE>${d.tipoDte}</TipoDTE><Folio>${d.folio}</Folio><FchEmis>${d.fechaEmision}</FchEmis>` +
    `<RUTEmisor>${rutValido(d.rutEmisor, 'RUTEmisor')}</RUTEmisor><RUTRecep>${rutValido(d.rutReceptor, 'RUTRecep')}</RUTRecep>` +
    `<MntTotal>${d.montoTotal}</MntTotal><EstadoRecepDTE>${d.estado}</EstadoRecepDTE>` +
    `<RecepDTEGlosa>${texto(d.glosa, 256)}</RecepDTEGlosa>` +
    '</RecepcionDTE>'
  );
}

function recepcionEnvio(a: AnalisisEnvio): string {
  const nombre = a.nombreArchivo ?? 'envio.xml';
  const codigo = enteroPositivo(a.codigoEnvio ?? 1, 'codigoEnvio', 10);
  const rutEmisor = a.rutEmisor && validarRut(a.rutEmisor) ? a.rutEmisor : undefined;
  const rutReceptor = a.rutReceptor && validarRut(a.rutReceptor) ? a.rutReceptor : undefined;
  const dtes = a.dtes.length > 0 ? a.dtes.map(recepcionDte).join('') : '';
  return (
    '<RecepcionEnvio>' +
    `<NmbEnvio>${texto(nombre, 80)}</NmbEnvio>` +
    `<FchRecep>${formatearTimestampSii(a.fechaRecepcion ?? new Date())}</FchRecep>` +
    `<CodEnvio>${codigo}</CodEnvio>` +
    `<EnvioDTEID>${texto(a.idSet ?? '', 80)}</EnvioDTEID>` +
    (a.digest ? `<Digest>${a.digest}</Digest>` : '') +
    (rutEmisor ? `<RutEmisor>${rutEmisor}</RutEmisor>` : '') +
    (rutReceptor ? `<RutReceptor>${rutReceptor}</RutReceptor>` : '') +
    `<EstadoRecepEnv>${a.estado}</EstadoRecepEnv>` +
    `<RecepEnvGlosa>${texto(a.glosa, 256)}</RecepEnvGlosa>` +
    (a.dtes.length > 0 ? `<NroDTE>${enteroPositivo(a.dtes.length, 'NroDTE', 4)}</NroDTE>` : '') +
    dtes +
    '</RecepcionEnvio>'
  );
}

/**
 * Acuse de recibo del envío: `RespuestaDTE/Resultado/RecepcionEnvio` (uno por análisis), con el estado
 * del envío y el de cada DTE. Firmado sobre `Resultado/@ID`, ISO-8859-1.
 *
 * `RutRecibe` y `RutResponde` salen del análisis; si el archivo fue ilegible (91) o inválido el análisis
 * puede no traer el RUT emisor y debe indicarse `datos.rutRecibe`.
 */
export function construirRecepcionEnvio(
  analisis: AnalisisEnvio | AnalisisEnvio[],
  datos: DatosRespuesta,
): RespuestaConstruida {
  const lista = Array.isArray(analisis) ? analisis : [analisis];
  if (lista.length === 0) throw new ErrorValidacionDte('Se requiere al menos un envío para responder');
  if (lista.length > 1000) throw new ErrorValidacionDte('Una respuesta admite hasta 1000 envíos');
  const rutResponde = rutValido(datos.rutResponde ?? lista[0].receptor, 'rutResponde');
  const rutRecibe = rutValido(datos.rutRecibe ?? lista[0].rutEmisor, 'rutRecibe');
  const cuerpo = caratula(datos, rutResponde, rutRecibe, lista.length) + lista.map(recepcionEnvio).join('');
  return envolverYFirmar(cuerpo, datos);
}

/** Arma el resultado comercial de un DTE analizado (por defecto, aceptado). */
export function resultadoDesdeAnalisis(
  dte: AnalisisDte,
  codigoEnvio: number,
  estado: EstadoDteCodigo = 0,
  glosa?: string,
  codigoRechazo?: number,
): ResultadoComercialDte {
  return {
    tipoDte: dte.tipoDte,
    folio: dte.folio,
    fechaEmision: dte.fechaEmision,
    rutEmisor: dte.rutEmisor,
    rutReceptor: dte.rutReceptor,
    montoTotal: dte.montoTotal,
    codigoEnvio,
    estado,
    glosa,
    codigoRechazo,
  };
}

function resultadoDte(r: ResultadoComercialDte): string {
  if (r.codigoRechazo !== undefined && (!Number.isInteger(r.codigoRechazo) || r.codigoRechazo >= 0 || r.codigoRechazo < -999)) {
    throw new ErrorValidacionDte(`codigoRechazo debe ser un entero negativo de hasta 3 dígitos (recibido ${r.codigoRechazo})`);
  }
  return (
    '<ResultadoDTE>' +
    `<TipoDTE>${r.tipoDte}</TipoDTE><Folio>${r.folio}</Folio><FchEmis>${r.fechaEmision}</FchEmis>` +
    `<RUTEmisor>${rutValido(r.rutEmisor, 'RUTEmisor')}</RUTEmisor><RUTRecep>${rutValido(r.rutReceptor, 'RUTRecep')}</RUTRecep>` +
    `<MntTotal>${r.montoTotal}</MntTotal><CodEnvio>${enteroPositivo(r.codigoEnvio, 'codigoEnvio', 10)}</CodEnvio>` +
    `<EstadoDTE>${r.estado}</EstadoDTE>` +
    `<EstadoDTEGlosa>${texto(r.glosa ?? GLOSA_ESTADO_DTE[r.estado], 256)}</EstadoDTEGlosa>` +
    (r.codigoRechazo !== undefined ? `<CodRchDsc>${r.codigoRechazo}</CodRchDsc>` : '') +
    '</ResultadoDTE>'
  );
}

/**
 * Resultado comercial (aceptación o rechazo) de uno o más DTE: `RespuestaDTE/Resultado/ResultadoDTE`.
 * El XSD no admite mezclar `RecepcionEnvio` y `ResultadoDTE` en una misma respuesta (es una `choice`).
 * Una factura rechazada según la Ley 19.983 debe indicar expresamente el motivo en `glosa`.
 * Requiere `datos.rutResponde` y `datos.rutRecibe`.
 */
export function construirResultadoDte(
  resultados: ResultadoComercialDte[],
  datos: DatosRespuesta,
): RespuestaConstruida {
  if (resultados.length === 0) throw new ErrorValidacionDte('Se requiere al menos un resultado de DTE');
  if (resultados.length > 1000) throw new ErrorValidacionDte('Una respuesta admite hasta 1000 resultados');
  const rutResponde = rutValido(datos.rutResponde, 'rutResponde');
  const rutRecibe = rutValido(datos.rutRecibe ?? resultados[0].rutEmisor, 'rutRecibe');
  const cuerpo = caratula(datos, rutResponde, rutRecibe, resultados.length) + resultados.map(resultadoDte).join('');
  return envolverYFirmar(cuerpo, datos);
}

