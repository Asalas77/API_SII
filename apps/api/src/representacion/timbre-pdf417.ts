import bwipjs from 'bwip-js';
import iconv from 'iconv-lite';

/**
 * Parámetros del PDF417 del timbre electrónico (Instructivo de Emisión DTE, Anexo 2, A.2.5).
 *
 * - Modo de codificación binario (Byte Compaction): se pasa el TED como bytes ISO-8859-1
 *   (`binarytext: true`, cada carácter del string = 1 byte) y no como UTF-8.
 * - Error Correction Level 5.
 * - No truncado (`compact: false`).
 * - 15 columnas de datos: con un TED típico (~650 bytes) da ~7 cm x ~2,7 cm impresos (recomendado: máx. 3 x 9 cm).
 * - X dim (módulo más angosto) = `XDIM_PT` = 0,6 pt = 8,3 mils (mínimo exigido: 6,7 mils).
 * - Y dim = 3 X (relación 3:1): `rowmult: 3` en BWIPP, que multiplica el alto de fila por el módulo.
 * - El PNG se genera a `PX_POR_MODULO` px por módulo (480 dpi al imprimir a XDIM_PT por módulo).
 */
export const PDF417_ECL = 5;
export const PDF417_COLUMNAS = 15;
export const PDF417_FILA_X = 3;
/** Ancho del módulo al imprimir, en puntos (1/72"): 0,6 pt = 8,3 mils >= 6,7 mils. */
export const XDIM_PT = 0.6;
export const PX_POR_MODULO = 4;

/** Extrae los bytes ISO-8859-1 del TED tal como van en el XML. Falla si hay caracteres fuera de Latin-1. */
export function bytesTed(tedXml: string): Buffer {
  for (const c of tedXml) {
    if (c.codePointAt(0)! > 0xff) throw new Error(`El TED contiene un carácter fuera de ISO-8859-1: ${JSON.stringify(c)}`);
  }
  return iconv.encode(tedXml, 'ISO-8859-1');
}

/**
 * Genera el PNG del PDF417 del timbre desde el TED textual (`<TED version="1.0">...</TED>`), sin re-serializar.
 * El PNG no incluye zona de silencio (el generador de PDF deja >= 0,25" alrededor).
 */
export async function generarPdf417(tedXml: string): Promise<Buffer> {
  const bytes = bytesTed(tedXml.trim());
  return bwipjs.toBuffer({
    bcid: 'pdf417',
    // Un carácter por byte (latin1) + binarytext: bwip-js no re-codifica a UTF-8.
    text: bytes.toString('latin1'),
    binarytext: true,
    eclevel: PDF417_ECL,
    columns: PDF417_COLUMNAS,
    compact: false,
    rowmult: PDF417_FILA_X,
    scale: PX_POR_MODULO,
  } as bwipjs.RenderOptions);
}

/** Tamaño en píxeles de un PNG (lee el chunk IHDR). */
export function dimensionesPng(png: Buffer): { ancho: number; alto: number } {
  if (png.length < 24 || png.readUInt32BE(0) !== 0x89504e47) throw new Error('No es un PNG');
  return { ancho: png.readUInt32BE(16), alto: png.readUInt32BE(20) };
}
