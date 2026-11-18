import { XMLParser } from 'fast-xml-parser';
import iconv from 'iconv-lite';
import { SiiError } from './errores.js';

const parser = new XMLParser({
  ignoreAttributes: true,
  removeNSPrefix: true,
  parseTagValue: false,
  trimValues: true,
});

/** Parsea XML a objeto; sin prefijos de namespace, valores siempre string. */
export function parsearXml(xml: string): Record<string, unknown> {
  try {
    return parser.parse(xml) as Record<string, unknown>;
  } catch (e) {
    throw new SiiError('Respuesta XML inválida del SII', { cause: e, cuerpo: xml });
  }
}

/** Busca recursivamente (primera coincidencia, en profundidad) una clave en un objeto parseado. */
export function buscarClave(obj: unknown, clave: string): unknown {
  if (obj === null || typeof obj !== 'object') return undefined;
  if (Array.isArray(obj)) {
    for (const el of obj) {
      const r = buscarClave(el, clave);
      if (r !== undefined) return r;
    }
    return undefined;
  }
  const rec = obj as Record<string, unknown>;
  if (clave in rec) return rec[clave];
  for (const v of Object.values(rec)) {
    const r = buscarClave(v, clave);
    if (r !== undefined) return r;
  }
  return undefined;
}

/** Como `buscarClave` pero devuelve string (o undefined si falta o no es texto). */
export function buscarTexto(obj: unknown, clave: string): string | undefined {
  const v = buscarClave(obj, clave);
  if (v === undefined || v === null || typeof v === 'object') return undefined;
  return typeof v === 'string' ? v : String(v as number | boolean);
}

/** Siempre devuelve arreglo (el parser entrega un valor suelto si hay uno solo). */
export function comoArreglo<T = unknown>(v: unknown): T[] {
  if (v === undefined || v === null || v === '') return [];
  return Array.isArray(v) ? (v as T[]) : [v as T];
}

export function escaparXml(texto: string): string {
  return texto
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

/** Encoding declarado en el prólogo XML (por defecto utf-8). */
function encodingDeclarado(cabecera: string): string {
  const m = /^\s*<\?xml[^>]*encoding\s*=\s*["']([^"']+)["']/i.exec(cabecera);
  return m?.[1]?.toLowerCase() ?? 'utf-8';
}

function esLatin1(enc: string): boolean {
  return enc === 'iso-8859-1' || enc === 'latin1' || enc === 'iso8859-1';
}

/** Codifica el XML a bytes respetando el encoding declarado (ISO-8859-1 típico de DTE). */
export function codificarXml(xml: string | Uint8Array): Uint8Array {
  if (typeof xml !== 'string') return xml;
  if (esLatin1(encodingDeclarado(xml.slice(0, 200)))) {
    return new Uint8Array(iconv.encode(xml, 'latin1'));
  }
  return new TextEncoder().encode(xml);
}

/** Lee el cuerpo de una Response respetando el encoding declarado en el prólogo XML. */
export async function leerTextoXml(resp: Response): Promise<string> {
  const bytes = Buffer.from(await resp.arrayBuffer());
  const cabecera = bytes.subarray(0, 200).toString('latin1');
  return esLatin1(encodingDeclarado(cabecera))
    ? iconv.decode(bytes, 'latin1')
    : bytes.toString('utf8');
}
