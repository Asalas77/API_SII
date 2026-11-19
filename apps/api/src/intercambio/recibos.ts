import {
  aIso88591,
  ErrorValidacionDte,
  escaparXml,
  firmarXml,
  formatearTimestampSii,
  sanearLatin1,
  validarRut,
} from '../dte-core/index.js';
import type { AnalisisDte } from './recepcion.js';
import { NS_SII, type CertificadoFirma, type RespuestaConstruida } from './respuesta-dte.js';

const NS_XSI = 'http://www.w3.org/2001/XMLSchema-instance';
export const ID_SET_RECIBOS = 'SetRecibos';

/** Tipos admitidos por `DocType` de `Recibos_v10.xsd`. */
export const TIPOS_RECIBO = [33, 34, 46, 52, 56, 61] as const;

/**
 * Declaración textual exigida por `Recibos_v10.xsd` (`xs:element ... fixed`), tal cual (sin tildes).
 * Cualquier variación hace inválido el documento.
 */
export const DECLARACION_LEY_19983 =
  'El acuse de recibo que se declara en este acto, de acuerdo a lo dispuesto en la letra b) del Art. 4, ' +
  'y la letra c) del Art. 5 de la Ley 19.983, acredita que la entrega de mercaderias o servicio(s) prestado(s) ha(n) sido recibido(s).';

export interface DocumentoRecibido {
  tipoDoc: number;
  folio: number;
  /** `yyyy-mm-dd`. */
  fechaEmision: string;
  rutEmisor: string;
  rutReceptor: string;
  montoTotal: number;
  /** Lugar donde se materializa la recepción conforme (máx. 80). Por defecto `datos.recinto`. */
  recinto?: string;
}

export interface DatosRecibos {
  /** `RutResponde`: receptor de los documentos (`12345678-5`). */
  rutResponde: string;
  /** `RutRecibe`: emisor de los documentos. Por defecto, el RUT emisor del primer documento. */
  rutRecibe?: string;
  /** `RutFirma`: RUT de quien firma los recibos (titular del certificado). */
  rutFirma: string;
  /** Recinto por defecto de los recibos. */
  recinto: string;
  certificado: CertificadoFirma;
  nombreContacto?: string;
  fonoContacto?: string;
  mailContacto?: string;
  /** `TmstFirmaRecibo` y `TmstFirmaEnv`. Por defecto, ahora. */
  fechaFirma?: Date;
}

function texto(valor: string, max: number): string {
  return escaparXml(Array.from(sanearLatin1(valor).trim()).slice(0, max).join(''));
}

function rutValido(rut: string | undefined, campo: string): string {
  const r = (rut ?? '').replace(/\./g, '').trim().toUpperCase();
  if (!validarRut(r)) throw new ErrorValidacionDte(`${campo}: RUT inválido (${rut ?? 'ausente'})`);
  return r;
}

/** Documento recibido a partir de un DTE analizado (falta `recinto`, que lo aporta `datos.recinto`). */
export function documentoRecibidoDesdeAnalisis(dte: AnalisisDte): DocumentoRecibido {
  return {
    tipoDoc: dte.tipoDte,
    folio: dte.folio,
    fechaEmision: dte.fechaEmision,
    rutEmisor: dte.rutEmisor,
    rutReceptor: dte.rutReceptor,
    montoTotal: dte.montoTotal,
  };
}

/** Un `<Recibo>` firmado (la firma cubre `DocumentoRecibo/@ID` y queda como último hijo de `Recibo`). */
function construirRecibo(doc: DocumentoRecibido, id: string, datos: DatosRecibos, ts: string): string {
  if (!(TIPOS_RECIBO as readonly number[]).includes(doc.tipoDoc)) {
    throw new ErrorValidacionDte(`Tipo de documento ${doc.tipoDoc} no admitido en recibos (${TIPOS_RECIBO.join(', ')})`);
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(doc.fechaEmision)) throw new ErrorValidacionDte(`fechaEmision inválida: ${doc.fechaEmision}`);
  const recinto = doc.recinto ?? datos.recinto;
  const sinFirma =
    // xmlns y xmlns:xsi se repiten en el Recibo (igual que en EnvioRecibos) para que la canonización
    // de DocumentoRecibo sea idéntica con el Recibo suelto y anidado en el sobre.
    `<Recibo xmlns="${NS_SII}" xmlns:xsi="${NS_XSI}" version="1.0">` +
    `<DocumentoRecibo ID="${id}">` +
    `<TipoDoc>${doc.tipoDoc}</TipoDoc><Folio>${doc.folio}</Folio><FchEmis>${doc.fechaEmision}</FchEmis>` +
    `<RUTEmisor>${rutValido(doc.rutEmisor, 'RUTEmisor')}</RUTEmisor><RUTRecep>${rutValido(doc.rutReceptor, 'RUTRecep')}</RUTRecep>` +
    `<MntTotal>${doc.montoTotal}</MntTotal>` +
    `<Recinto>${texto(recinto, 80)}</Recinto>` +
    `<RutFirma>${rutValido(datos.rutFirma, 'rutFirma')}</RutFirma>` +
    `<Declaracion>${DECLARACION_LEY_19983}</Declaracion>` +
    `<TmstFirmaRecibo>${ts}</TmstFirmaRecibo>` +
    '</DocumentoRecibo></Recibo>';
  return firmarXml(sinFirma, { ...datos.certificado, idReferencia: id });
}

/**
 * Genera el `EnvioRecibos` (Ley 19.983): un `Recibo` firmado por documento y la firma del `SetRecibos`.
 *
 * Firmas anidadas (3 niveles de XML, 2 de firma):
 * ```
 * EnvioRecibos
 *   SetRecibos ID="SetRecibos"
 *     Caratula
 *     Recibo (uno por documento)
 *       DocumentoRecibo ID="R1T33F1"
 *       Signature  -> Reference #R1T33F1 (firma individual del recibo)
 *     Recibo ...
 *   Signature      -> Reference #SetRecibos (cubre Caratula y todos los Recibo, con sus firmas)
 * ```
 * Cada `Recibo` se firma primero como documento independiente y se inserta textualmente en el set.
 */
export function construirEnvioRecibos(documentos: DocumentoRecibido[], datos: DatosRecibos): RespuestaConstruida {
  if (documentos.length === 0) throw new ErrorValidacionDte('Se requiere al menos un documento para el recibo');
  const ts = formatearTimestampSii(datos.fechaFirma ?? new Date());
  const rutResponde = rutValido(datos.rutResponde, 'rutResponde');
  const rutRecibe = rutValido(datos.rutRecibe ?? documentos[0].rutEmisor, 'rutRecibe');

  const recibos = documentos.map((d, i) => construirRecibo(d, `R${i + 1}T${d.tipoDoc}F${d.folio}`, datos, ts));
  const caratula =
    '<Caratula version="1.0">' +
    `<RutResponde>${rutResponde}</RutResponde><RutRecibe>${rutRecibe}</RutRecibe>` +
    (datos.nombreContacto ? `<NmbContacto>${texto(datos.nombreContacto, 40)}</NmbContacto>` : '') +
    (datos.fonoContacto ? `<FonoContacto>${texto(datos.fonoContacto, 40)}</FonoContacto>` : '') +
    (datos.mailContacto ? `<MailContacto>${texto(datos.mailContacto, 80)}</MailContacto>` : '') +
    `<TmstFirmaEnv>${ts}</TmstFirmaEnv>` +
    '</Caratula>';
  const sobre =
    `<EnvioRecibos xmlns="${NS_SII}" xmlns:xsi="${NS_XSI}" xsi:schemaLocation="${NS_SII} EnvioRecibos_v10.xsd" version="1.0">` +
    `<SetRecibos ID="${ID_SET_RECIBOS}">${caratula}${recibos.join('')}</SetRecibos>` +
    '</EnvioRecibos>';
  const xml = firmarXml(sobre, { ...datos.certificado, idReferencia: ID_SET_RECIBOS });
  return { xml, xmlIso: aIso88591(xml) };
}
