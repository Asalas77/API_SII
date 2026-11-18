import { constants, createPrivateKey, createPublicKey, randomBytes, sign, verify } from 'node:crypto';
import { XMLParser } from 'fast-xml-parser';

/** Código de Autorización de Folios (archivo CAF entregado por el SII). */
export interface Caf {
  rutEmisor: string;
  razonSocial: string;
  tipoDte: number;
  folioDesde: number;
  folioHasta: number;
  /** Fecha de autorización `yyyy-mm-dd` (campo FA). */
  fechaAutorizacion: string;
  /** Fecha de vencimiento calculada: fechaAutorizacion + mesesVigencia (UTC, 00:00). */
  fechaVencimiento: Date;
  /** Identificador de la clave pública del SII (IDK). */
  idk: number;
  /** Módulo y exponente RSA (base64) declarados en `<RSAPK>`. */
  modulo: string;
  exponente: string;
  clavePrivadaPem: string;
  clavePublicaPem: string;
  /** Elemento `<CAF ...>...</CAF>` textual, tal cual viene en el archivo (se incrusta en el TED). */
  xmlCaf: string;
}

export interface OpcionesParseoCaf {
  /** Meses de vigencia desde la autorización (por defecto 6, regla SII para documentos con crédito fiscal). */
  mesesVigencia?: number;
}

/** Suma meses a una fecha `yyyy-mm-dd` (UTC), ajustando al último día del mes si hace falta. */
export function sumarMeses(fechaIso: string, meses: number): Date {
  const [a, m, d] = fechaIso.split('-').map(Number);
  const destino = new Date(Date.UTC(a, m - 1 + meses, 1));
  const ultimoDia = new Date(Date.UTC(destino.getUTCFullYear(), destino.getUTCMonth() + 1, 0)).getUTCDate();
  destino.setUTCDate(Math.min(d, ultimoDia));
  return destino;
}

function normalizarPem(pem: string): string {
  return pem
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean)
    .join('\n');
}

function texto(valor: unknown, campo: string): string {
  if ((typeof valor !== 'string' && typeof valor !== 'number') || String(valor).trim() === '') {
    throw new Error(`CAF inválido: falta el campo ${campo}`);
  }
  return String(valor).trim();
}

/** Parsea el archivo CAF del SII. Lanza `Error` si faltan campos obligatorios. */
export function parsearCaf(xml: string, opciones: OpcionesParseoCaf = {}): Caf {
  const parser = new XMLParser({ parseTagValue: false, parseAttributeValue: false, trimValues: true, ignoreAttributes: false });
  let raiz: any;
  try {
    raiz = parser.parse(xml);
  } catch (e) {
    throw new Error(`CAF inválido: XML mal formado (${(e as Error).message})`);
  }
  const aut = raiz?.AUTORIZACION;
  const da = aut?.CAF?.DA;
  if (!aut || !da) throw new Error('CAF inválido: no se encontró AUTORIZACION/CAF/DA');

  // El CAF se incrusta textualmente: se extrae del archivo sin reformatear.
  const m = /<CAF[\s>][\s\S]*<\/CAF>/.exec(xml);
  if (!m) throw new Error('CAF inválido: no se encontró el elemento <CAF>');

  const fechaAutorizacion = texto(da.FA, 'FA');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(fechaAutorizacion)) throw new Error('CAF inválido: FA con formato incorrecto');

  return {
    rutEmisor: texto(da.RE, 'RE'),
    razonSocial: texto(da.RS, 'RS'),
    tipoDte: Number(texto(da.TD, 'TD')),
    folioDesde: Number(texto(da.RNG?.D, 'RNG/D')),
    folioHasta: Number(texto(da.RNG?.H, 'RNG/H')),
    fechaAutorizacion,
    fechaVencimiento: sumarMeses(fechaAutorizacion, opciones.mesesVigencia ?? 6),
    idk: Number(texto(da.IDK, 'IDK')),
    modulo: texto(da.RSAPK?.M, 'RSAPK/M'),
    exponente: texto(da.RSAPK?.E, 'RSAPK/E'),
    clavePrivadaPem: normalizarPem(texto(aut.RSASK, 'RSASK')),
    clavePublicaPem: normalizarPem(texto(aut.RSAPUBK, 'RSAPUBK')),
    xmlCaf: m[0],
  };
}

/** Indica si el folio pertenece al rango autorizado del CAF. */
export function folioEnRango(caf: Pick<Caf, 'folioDesde' | 'folioHasta'>, folio: number): boolean {
  return Number.isInteger(folio) && folio >= caf.folioDesde && folio <= caf.folioHasta;
}

/** Indica si el CAF está vigente (no vencido) a la fecha dada (por defecto, ahora). */
export function cafVigente(caf: Pick<Caf, 'fechaVencimiento'>, fecha: Date = new Date()): boolean {
  return fecha.getTime() <= caf.fechaVencimiento.getTime() + 24 * 3600 * 1000 - 1;
}

/** Verifica que la clave privada del CAF corresponda a la pública (firma y verifica un dato aleatorio). */
export function claveCafCoincide(caf: Pick<Caf, 'clavePrivadaPem' | 'clavePublicaPem'>): boolean {
  try {
    const dato = randomBytes(32);
    const firma = sign('sha1', dato, {
      key: createPrivateKey(caf.clavePrivadaPem),
      padding: constants.RSA_PKCS1_PADDING,
    });
    return verify('sha1', dato, createPublicKey(caf.clavePublicaPem), firma);
  } catch {
    return false;
  }
}
