import iconv from 'iconv-lite';

/** Declaración XML estándar de los documentos enviados al SII. */
export const DECLARACION_XML_ISO = '<?xml version="1.0" encoding="ISO-8859-1"?>';

/** Escapa texto para usarlo como contenido o valor de atributo XML. */
export function escaparXml(texto: string): string {
  return texto
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

/** Reemplazos de caracteres frecuentes fuera de Latin-1 por equivalentes ASCII/Latin-1. */
const EQUIVALENTES: Record<string, string> = {
  '‘': "'",
  '’': "'",
  '“': '"',
  '”': '"',
  '–': '-',
  '—': '-',
  '…': '...',
  '€': 'EUR',
  '™': 'TM',
  'Š': 'S',
  'š': 's',
  'Ž': 'Z',
  'ž': 'z',
  'Œ': 'OE',
  'œ': 'oe',
};

/**
 * Convierte un string a Latin-1. Los caracteres fuera de ISO-8859-1 se reemplazan por un
 * equivalente (comillas tipográficas, guiones, etc.) o por `?` si no existe equivalente.
 */
export function sanearLatin1(texto: string): string {
  let salida = '';
  for (const ch of texto) {
    const cp = ch.codePointAt(0) as number;
    if (cp <= 0xff) salida += ch;
    else salida += EQUIVALENTES[ch] ?? '?';
  }
  return salida;
}

/**
 * Codifica un XML a ISO-8859-1. Si el XML no trae declaración se antepone
 * `<?xml version="1.0" encoding="ISO-8859-1"?>`; si trae una declaración, se reemplaza por
 * la de ISO-8859-1. Caracteres fuera de Latin-1 se reemplazan (ver `sanearLatin1`).
 */
export function aIso88591(xml: string): Buffer {
  const sinDeclaracion = xml.replace(/^﻿?\s*<\?xml[^?]*\?>\s*/, '');
  const texto = sanearLatin1(`${DECLARACION_XML_ISO}\n${sinDeclaracion}`);
  return iconv.encode(texto, 'ISO-8859-1');
}

/** Decodifica bytes ISO-8859-1 a string (no modifica la declaración XML). */
export function desdeIso88591(buffer: Buffer | Uint8Array): string {
  return iconv.decode(Buffer.from(buffer), 'ISO-8859-1');
}

const pad = (n: number | string, largo = 2) => String(n).padStart(largo, '0');
const ZONA_CHILE = 'America/Santiago';

function partesChile(fecha: Date): Record<string, string> {
  const fmt = new Intl.DateTimeFormat('en-CA', {
    timeZone: ZONA_CHILE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23',
  });
  const partes: Record<string, string> = {};
  for (const p of fmt.formatToParts(fecha)) partes[p.type] = p.value;
  return partes;
}

/** Fecha en hora de Chile con formato `yyyy-mm-dd`. */
export function formatearFechaSii(fecha: Date): string {
  const p = partesChile(fecha);
  return `${p.year}-${p.month}-${p.day}`;
}

/** Timestamp en hora de Chile `yyyy-mm-ddThh:mm:ss` (sin zona horaria). */
export function formatearTimestampSii(fecha: Date): string {
  const p = partesChile(fecha);
  return `${p.year}-${p.month}-${p.day}T${pad(p.hour)}:${p.minute}:${p.second}`;
}

/** Calcula el dígito verificador (módulo 11) de un RUT numérico. */
export function calcularDv(numero: number | string): string {
  const digitos = String(numero).replace(/\D/g, '');
  let suma = 0;
  let factor = 2;
  for (let i = digitos.length - 1; i >= 0; i--) {
    suma += Number(digitos[i]) * factor;
    factor = factor === 7 ? 2 : factor + 1;
  }
  const resto = 11 - (suma % 11);
  if (resto === 11) return '0';
  if (resto === 10) return 'K';
  return String(resto);
}

/** `formatearRut(12345678,'9') → '12345678-9'` (DV en mayúscula, sin puntos). */
export function formatearRut(numero: number | string, dv: string): string {
  return `${String(numero).replace(/\D/g, '')}-${dv.toUpperCase()}`;
}

/** Valida el DV de un RUT dado por separado. */
export function validarDv(numero: number | string, dv: string): boolean {
  return calcularDv(numero) === dv.toUpperCase();
}

/** Valida un RUT completo (`12345678-9`, admite puntos). */
export function validarRut(rut: string): boolean {
  const m = /^(\d{1,9})-([\dkK])$/.exec(rut.replace(/\./g, '').trim());
  return m !== null && validarDv(m[1], m[2]);
}

/** Separa `12345678-9` en número y DV, o `undefined` si el formato es inválido. */
export function separarRut(rut: string): { numero: string; dv: string } | undefined {
  const m = /^(\d{1,9})-([\dkK])$/.exec(rut.replace(/\./g, '').trim());
  return m ? { numero: m[1], dv: m[2].toUpperCase() } : undefined;
}
