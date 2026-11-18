import { constants, createPrivateKey, createPublicKey, sign, verify } from 'node:crypto';
import type { Caf } from '../caf/caf.js';
import { formatearTimestampSii, sanearLatin1 } from '../xml/xml.util.js';
import iconv from 'iconv-lite';

export interface DatosTed {
  rutEmisor: string;
  tipoDte: number;
  folio: number;
  /** Fecha de emisión `yyyy-mm-dd`. */
  fechaEmision: string;
  rutReceptor: string;
  razonSocialReceptor: string;
  monto: number;
  /** Descripción del primer ítem (IT1). */
  itemPrimero: string;
  /** Momento del timbraje (TSTED). Por defecto, ahora en hora de Chile. Un string se usa tal cual. */
  timestamp?: Date | string;
}

/** Escapa solo `& < >` (contenido de texto): el TED viaja en el PDF417 y se firma textualmente. */
function escaparTexto(t: string): string {
  return t.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/** Trunca a `max` caracteres (por code points) antes de escapar. */
function truncar(t: string, max: number): string {
  return Array.from(t.trim()).slice(0, max).join('');
}

function campo(valor: string): string {
  return escaparTexto(sanearLatin1(valor));
}

/** Bytes ISO-8859-1 del DD, que es lo que se firma. */
function bytesDd(dd: string): Buffer {
  return iconv.encode(sanearLatin1(dd), 'ISO-8859-1');
}

/**
 * Construye el TED firmado con la clave privada del CAF.
 * FRMT = RSA-SHA1(bytes ISO-8859-1 de `<DD>...</DD>`), en base64.
 */
export function generarTed(datos: DatosTed, caf: Caf): string {
  const ts =
    typeof datos.timestamp === 'string'
      ? datos.timestamp
      : formatearTimestampSii(datos.timestamp ?? new Date());
  const dd =
    '<DD>' +
    `<RE>${campo(datos.rutEmisor)}</RE>` +
    `<TD>${datos.tipoDte}</TD>` +
    `<F>${datos.folio}</F>` +
    `<FE>${datos.fechaEmision}</FE>` +
    `<RR>${campo(datos.rutReceptor)}</RR>` +
    `<RSR>${campo(truncar(datos.razonSocialReceptor, 40))}</RSR>` +
    `<MNT>${datos.monto}</MNT>` +
    `<IT1>${campo(truncar(datos.itemPrimero, 40))}</IT1>` +
    caf.xmlCaf +
    `<TSTED>${ts}</TSTED>` +
    '</DD>';
  const firma = sign('sha1', bytesDd(dd), {
    key: createPrivateKey(caf.clavePrivadaPem),
    padding: constants.RSA_PKCS1_PADDING,
  }).toString('base64');
  return `<TED version="1.0">${dd}<FRMT algoritmo="SHA1withRSA">${firma}</FRMT></TED>`;
}

/** Verifica la firma FRMT de un TED extrayendo `<DD>...</DD>` textualmente (sin re-serializar). */
export function verificarTed(tedXml: string, clavePublicaPem: string): boolean {
  const ini = tedXml.indexOf('<DD>');
  const fin = tedXml.lastIndexOf('</DD>');
  if (ini < 0 || fin < ini) return false;
  const dd = tedXml.slice(ini, fin + '</DD>'.length);
  const m = /<FRMT[^>]*>([^<]+)<\/FRMT>/.exec(tedXml.slice(fin));
  if (!m) return false;
  try {
    return verify('sha1', bytesDd(dd), createPublicKey(clavePublicaPem), Buffer.from(m[1].trim(), 'base64'));
  } catch {
    return false;
  }
}
