import { CLAUSULAS_VENTA_ADUANA } from './clausulas-venta.js';
import { FORMAS_PAGO_ADUANA } from './formas-pago.js';
import { MODALIDADES_VENTA_ADUANA } from './modalidades-venta.js';
import { GLOSAS_MONEDA_XSD, MONEDAS_ADUANA } from './monedas.js';
import { PAISES_ADUANA } from './paises.js';
import { PUERTOS_ADUANA } from './puertos.js';
import { TIPOS_BULTO_ADUANA } from './tipos-bulto.js';
import { UNIDADES_MEDIDA_ADUANA } from './unidades-medida.js';
import { VIAS_TRANSPORTE_ADUANA } from './vias-transporte.js';

export * from './clausulas-venta.js';
export * from './formas-pago.js';
export * from './modalidades-venta.js';
export * from './monedas.js';
export * from './paises.js';
export * from './puertos.js';
export * from './tipos-bulto.js';
export * from './unidades-medida.js';
export * from './vias-transporte.js';

/**
 * Tablas de códigos de Aduana (Anexo 51 del Compendio de Normas Aduaneras) usadas en los documentos de exportación.
 * Ver `docs/referencias-aduana/README.md` para la fuente y lo que falta.
 */
export const GLOSA_PAIS = new Map<number, string>(PAISES_ADUANA.map((p) => [p.codigo, p.nombre]));
export const GLOSA_PUERTO = new Map<number, string>(PUERTOS_ADUANA.map((p) => [p.codigo, p.nombre]));
export const GLOSA_VIA = new Map<number, string>(VIAS_TRANSPORTE_ADUANA.map((p) => [p.codigo, p.nombre]));
export const GLOSA_CLAUSULA = new Map<number, string>(CLAUSULAS_VENTA_ADUANA.map((p) => [p.codigo, `${p.sigla} - ${p.nombre}`]));
export const GLOSA_MODALIDAD = new Map<number, string>(MODALIDADES_VENTA_ADUANA.map((p) => [p.codigo, p.nombre]));
export const GLOSA_FORMA_PAGO = new Map<number, string>(FORMAS_PAGO_ADUANA.map((p) => [p.codigo, p.glosa]));
export const GLOSA_TIPO_BULTO = new Map<number, string>(TIPOS_BULTO_ADUANA.map((p) => [p.codigo, p.glosa ?? p.descripcion.split(':')[0] ?? '']));
export const GLOSA_UNIDAD = new Map<number, string>(UNIDADES_MEDIDA_ADUANA.map((p) => [p.codigo, p.abreviatura]));

/** Glosas de moneda que acepta `TpoMoneda` (enumeración `TipMonType` del XSD oficial). */
export const MONEDAS_XSD: ReadonlySet<string> = new Set(GLOSAS_MONEDA_XSD);
/** Código de Aduana de una glosa del XSD (p. ej. `DOLAR USA` -> 13), si la moneda figura en el Anexo 51-20. */
export function codigoAduanaDeMoneda(glosa: string): number | undefined {
  return MONEDAS_ADUANA.find((m) => m.glosaSii === glosa)?.codigo;
}
