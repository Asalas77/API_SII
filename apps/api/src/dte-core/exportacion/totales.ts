import { ErrorValidacionDte } from '../documento/errores.js';
import type { DocumentoDte } from '../documento/tipos.js';
import type { TotalesExportacion } from './tipos.js';

/**
 * Aritmética decimal exacta (enteros BigInt) para documentos de exportación. Los montos en moneda extranjera llevan
 * hasta 4 decimales (`MontoItem`, `MntExe`, `MntTotal`: decimal 18,4 en el XSD); cantidades y precios hasta 6
 * (`Dec12_6Type`); el equivalente en pesos se redondea a entero (mitades hacia arriba).
 */
const E4 = 10_000n;

/** Convierte a escala `dec` (entero BigInt) sin errores de coma flotante visibles; rechaza más decimales que `dec`. */
export function escalar(n: number, dec: number, campo: string): bigint {
  if (!Number.isFinite(n)) throw new ErrorValidacionDte(`${campo}: no es un número`, campo);
  const texto = n.toFixed(dec + 4);
  const [ent, frac = ''] = texto.replace('-', '').split('.');
  if (/[1-9]/.test(frac.slice(dec))) {
    throw new ErrorValidacionDte(`${campo}: admite como máximo ${dec} decimales (recibido ${n})`, campo);
  }
  const v = BigInt(ent + frac.slice(0, dec).padEnd(dec, '0'));
  return n < 0 ? -v : v;
}

/** Divide redondeando mitades hacia arriba (valores no negativos). */
function dividir(num: bigint, den: bigint): bigint {
  return (num + den / 2n) / den;
}

export function bigAString(v: bigint, dec: number): string {
  const neg = v < 0n;
  const s = (neg ? -v : v).toString().padStart(dec + 1, '0');
  const ent = s.slice(0, s.length - dec);
  const frac = s.slice(s.length - dec).replace(/0+$/, '');
  return `${neg ? '-' : ''}${ent}${frac ? '.' + frac : ''}`;
}

const aNumero = (v: bigint, dec: number): number => Number(bigAString(v, dec));

/**
 * Totales de 110/111/112: no hay IVA; el monto exento es el total. `MontoItem = round4(cantidad x precio) - descuentos`
 * (el descuento % se redondea sobre el bruto de la línea). Descuentos/recargos globales sobre la suma de líneas.
 */
export function calcularTotalesExportacion(doc: DocumentoDte): TotalesExportacion {
  const ex = doc.exportacion;
  if (!ex) throw new ErrorValidacionDte('exportacion: es obligatorio en los documentos de exportación (110, 111, 112)', 'exportacion');
  const montos = doc.detalle.map((l, i) => {
    const cant = escalar(l.cantidad ?? 0, 6, `detalle[${i}].cantidad`);
    const prec = escalar(l.precioUnitario, 6, `detalle[${i}].precioUnitario`);
    const bruto = dividir(cant * prec, 100_000_000n); // escala 12 -> 4
    let desc = 0n;
    if (l.descuentoPorcentaje !== undefined) {
      desc += dividir(bruto * escalar(l.descuentoPorcentaje, 2, `detalle[${i}].descuentoPorcentaje`), 10_000n);
    }
    if (l.descuentoMonto !== undefined) desc += escalar(l.descuentoMonto, 0, `detalle[${i}].descuentoMonto`) * E4;
    const neto = bruto - desc;
    if (neto < 0n) {
      throw new ErrorValidacionDte(`detalle[${i}]: el descuento supera el monto de la línea`, `detalle[${i}].descuentoMonto`);
    }
    return neto;
  });
  const sumaLineas = montos.reduce((a, b) => a + b, 0n);
  let total = sumaLineas;
  const globales = (doc.descuentosRecargos ?? []).map((dr, i) => {
    const valor =
      dr.tipoValor === '%'
        ? dividir(sumaLineas * escalar(dr.valor, 2, `descuentosRecargos[${i}].valor`), 10_000n)
        : escalar(dr.valor, 2, `descuentosRecargos[${i}].valor`) * 100n;
    total += dr.tipo === 'D' ? -valor : valor;
    return valor;
  });
  if (total < 0n) throw new ErrorValidacionDte('Los descuentos globales superan el monto del documento', 'descuentosRecargos');

  const tc = escalar(ex.tipoCambio, 4, 'exportacion.tipoCambio');
  const pesos = dividir(total * tc, 100_000_000n); // escala 8 -> entero
  return {
    moneda: ex.moneda,
    tipoCambio: ex.tipoCambio,
    montosLineas: montos.map((m) => aNumero(m, 4)),
    montosGlobales: globales.map((m) => aNumero(m, 4)),
    montoExento: aNumero(total, 4),
    montoTotal: aNumero(total, 4),
    montoExentoPesos: Number(pesos),
    montoTotalPesos: Number(pesos),
  };
}
