import { escaparXml, formatearRut, sanearLatin1, validarDv } from '../xml/xml.util.js';
import { ErrorValidacionDte } from './errores.js';

export const NS_SII = 'http://www.sii.cl/SiiDte';
export const NS_XSI = 'http://www.w3.org/2001/XMLSchema-instance';
export const RUT_GENERICO = '66666666-6';

// ---------------------------------------------------------------------------------------------
// Helpers de serialización
// ---------------------------------------------------------------------------------------------

/** Trunca por code points y quita espacios en los extremos. */
export function truncar(texto: string, max: number): string {
  return Array.from(texto.trim()).slice(0, max).join('');
}

/**
 * Elemento de texto: se sanea a Latin-1 (la firma se calcula sobre lo que se transmite),
 * se trunca a `max` caracteres (si se indica) y se escapa. Omite el elemento si el valor es vacío.
 */
export function tag(nombre: string, valor: string | number | undefined | null, max?: number): string {
  if (valor === undefined || valor === null) return '';
  let v = typeof valor === 'number' ? String(valor) : sanearLatin1(valor);
  if (max !== undefined) v = truncar(v, max);
  if (v === '') return '';
  return `<${nombre}>${escaparXml(v)}</${nombre}>`;
}

/** Decimal sin notación científica ni ceros sobrantes (hasta `decimales`). */
export function numeroXml(n: number, decimales = 6): string {
  if (Number.isInteger(n)) return String(n);
  return n.toFixed(decimales).replace(/\.?0+$/, '');
}

export function rutDe(rut: string | number, dv: string, ctx: string): string {
  const cuerpo = String(rut).replace(/\D/g, '');
  if (!cuerpo || !/^[\dkK]$/.test(dv)) throw new ErrorValidacionDte(`${ctx}: RUT inválido (${rut}-${dv})`);
  if (!validarDv(cuerpo, dv)) throw new ErrorValidacionDte(`${ctx}: dígito verificador incorrecto (${rut}-${dv})`);
  const r = formatearRut(cuerpo, dv);
  if (r.length > 10) throw new ErrorValidacionDte(`${ctx}: RUT demasiado largo (${r})`);
  return r;
}

export function validarFecha(valor: string | undefined, ctx: string): void {
  if (valor === undefined) return;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(valor) || Number.isNaN(Date.parse(`${valor}T00:00:00Z`))) {
    throw new ErrorValidacionDte(`${ctx}: fecha inválida (${valor}), se espera yyyy-mm-dd`);
  }
}

