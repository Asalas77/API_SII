import { ErrorValidacionDte } from '../documento/errores.js';
import { escaparXml, sanearLatin1, separarRut, validarDv } from '../xml/xml.util.js';

/** Credenciales de firma del contribuyente (certificado y clave privada, PEM). */
export interface CertificadoFirma {
  certificadoPem: string;
  clavePrivadaPem: string;
}

export type TipoLibro = 'MENSUAL' | 'ESPECIAL' | 'RECTIFICA';
export type TipoEnvioLibro = 'TOTAL' | 'PARCIAL' | 'FINAL' | 'AJUSTE';

export const TIPOS_ENVIO_LIBRO: readonly TipoEnvioLibro[] = ['TOTAL', 'PARCIAL', 'FINAL', 'AJUSTE'];
export const TIPOS_LIBRO: readonly TipoLibro[] = ['MENSUAL', 'ESPECIAL', 'RECTIFICA'];

export const NS_SII_LIBRO = 'http://www.sii.cl/SiiDte';
export const NS_XSI_LIBRO = 'http://www.w3.org/2001/XMLSchema-instance';

const MAX_MONTO = Number.MAX_SAFE_INTEGER;

/** Entero no negativo (montos en pesos, contadores). */
export function enteroNoNegativo(valor: unknown, campo: string): number {
  if (typeof valor !== 'number' || !Number.isSafeInteger(valor) || valor < 0 || valor > MAX_MONTO) {
    throw new ErrorValidacionDte(`${campo} debe ser un entero no negativo (recibido ${String(valor)})`);
  }
  return valor;
}

/** Valida un RUT `12345678-9` (con DV correcto) y lo devuelve normalizado, sin puntos. */
export function rutLibro(valor: string, campo: string): string {
  const r = separarRut(valor);
  if (!r || !validarDv(r.numero, r.dv)) throw new ErrorValidacionDte(`${campo}: RUT inválido (${valor})`);
  return `${Number(r.numero)}-${r.dv}`;
}

export function periodoLibro(valor: string): string {
  const m = /^(\d{4})-(\d{2})$/.exec(valor);
  if (!m || Number(m[2]) < 1 || Number(m[2]) > 12) {
    throw new ErrorValidacionDte(`PeriodoTributario inválido (se espera AAAA-MM): ${valor}`);
  }
  return valor;
}

export function fechaLibro(valor: string, campo: string): string {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(valor) || Number.isNaN(Date.parse(`${valor}T00:00:00Z`))) {
    throw new ErrorValidacionDte(`${campo} inválida (se espera AAAA-MM-DD): ${valor}`);
  }
  return valor;
}

export function resolucionLibro(fecha: string, numero: number): { fecha: string; numero: number } {
  if (!Number.isInteger(numero) || numero < 0 || numero > 999_999) {
    throw new ErrorValidacionDte(`NroResol inválido: ${numero}`);
  }
  return { fecha: fechaLibro(fecha, 'FchResol'), numero };
}

/** Texto saneado a Latin-1, truncado al máximo del XSD y escapado. */
export function textoLibro(valor: string, max: number): string {
  return escaparXml(sanearLatin1(valor.trim()).slice(0, max));
}

/** `<tag>valor</tag>` */
export function tag(nombre: string, valor: string | number): string {
  return `<${nombre}>${valor}</${nombre}>`;
}

/** Como `tag` pero omite el elemento si el valor es `undefined`. */
export function tagOpc(nombre: string, valor: string | number | undefined): string {
  return valor === undefined ? '' : tag(nombre, valor);
}

/** Entero con signo (los resúmenes de segmento pueden ser negativos). */
export function enteroSigno(valor: number): string {
  return String(Math.trunc(valor) === 0 ? 0 : Math.trunc(valor));
}

/** Verifica las reglas de combinación de carátula comunes a ambos libros. */
export function validarCaratulaComun(c: {
  tipoLibro: TipoLibro;
  tipoEnvio: TipoEnvioLibro;
  nroSegmento?: number;
  folioNotificacion?: number;
}): void {
  if (!TIPOS_LIBRO.includes(c.tipoLibro)) throw new ErrorValidacionDte(`TipoLibro inválido: ${c.tipoLibro}`);
  if (!TIPOS_ENVIO_LIBRO.includes(c.tipoEnvio)) throw new ErrorValidacionDte(`TipoEnvio inválido: ${c.tipoEnvio}`);
  if (c.tipoEnvio === 'PARCIAL') {
    if (!Number.isInteger(c.nroSegmento) || (c.nroSegmento as number) < 1 || (c.nroSegmento as number) > 999_999) {
      throw new ErrorValidacionDte('El envío PARCIAL requiere NroSegmento (entero positivo)');
    }
  } else if (c.nroSegmento !== undefined) {
    throw new ErrorValidacionDte('NroSegmento solo corresponde a envíos PARCIAL');
  }
  if (c.folioNotificacion !== undefined) {
    if (!Number.isInteger(c.folioNotificacion) || c.folioNotificacion < 1) {
      throw new ErrorValidacionDte('FolioNotificacion debe ser un entero positivo');
    }
  }
}
