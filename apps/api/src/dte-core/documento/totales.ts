import { ErrorValidacionDte } from './errores.js';
import {
  esBoleta,
  esTipoExento,
  TASA_IVA,
  type DescuentoRecargoGlobal,
  type DetalleDte,
  type DocumentoDte,
  type TotalesDte,
} from './tipos.js';

/**
 * Redondeo comercial a entero (mitades hacia arriba) para valores no negativos.
 * Se normaliza a 6 decimales antes para absorber el ruido de punto flotante (1.005 * 1000, etc.).
 */
export function redondear(valor: number): number {
  return Math.round(Number(valor.toFixed(6)));
}

/** IVA de un neto: `round(neto * 19%)`, mitades hacia arriba, con aritmética entera. */
export function calcularIva(neto: number): number {
  return Math.floor((neto * TASA_IVA + 50) / 100);
}

/** Neto contenido en un monto bruto con IVA incluido: `round(bruto / 1.19)`, con aritmética entera. */
export function netoDesdeBruto(bruto: number): number {
  return Math.floor((bruto * 200 + (100 + TASA_IVA) * 1) / (2 * (100 + TASA_IVA)));
}

/**
 * `MontoItem` de una línea: `round(cantidad * precio) - descuento`.
 * El descuento por porcentaje se redondea sobre el bruto de la línea.
 */
export function calcularMontoLinea(linea: DetalleDte, numeroLinea = 0): number {
  const ref = `Línea ${numeroLinea || '?'} (${linea.nombre})`;
  if (!Number.isFinite(linea.cantidad) || linea.cantidad <= 0) {
    throw new ErrorValidacionDte(`${ref}: la cantidad debe ser mayor que 0`);
  }
  if (!Number.isFinite(linea.precioUnitario) || linea.precioUnitario < 0) {
    throw new ErrorValidacionDte(`${ref}: el precio unitario no puede ser negativo`);
  }
  if (linea.descuentoPorcentaje !== undefined && linea.descuentoMonto !== undefined) {
    throw new ErrorValidacionDte(`${ref}: use descuentoPorcentaje o descuentoMonto, no ambos`);
  }
  const bruto = redondear(linea.cantidad * linea.precioUnitario);
  let descuento = 0;
  if (linea.descuentoPorcentaje !== undefined) {
    if (!(linea.descuentoPorcentaje > 0 && linea.descuentoPorcentaje <= 100)) {
      throw new ErrorValidacionDte(`${ref}: descuentoPorcentaje debe estar entre 0,01 y 100`);
    }
    descuento = redondear((bruto * linea.descuentoPorcentaje) / 100);
  } else if (linea.descuentoMonto !== undefined) {
    if (!Number.isInteger(linea.descuentoMonto) || linea.descuentoMonto <= 0) {
      throw new ErrorValidacionDte(`${ref}: descuentoMonto debe ser un entero positivo`);
    }
    descuento = linea.descuentoMonto;
  }
  if (descuento > bruto) throw new ErrorValidacionDte(`${ref}: el descuento supera el valor de la línea`);
  return bruto - descuento;
}

/** Monto (positivo) de un descuento/recargo global sobre su base. */
function montoGlobal(dr: DescuentoRecargoGlobal, base: number, n: number): number {
  if (!(dr.valor > 0)) throw new ErrorValidacionDte(`Descuento/recargo global ${n}: el valor debe ser mayor que 0`);
  if (dr.tipoValor === '%') {
    if (dr.valor > 100) throw new ErrorValidacionDte(`Descuento/recargo global ${n}: el porcentaje no puede superar 100`);
    return redondear((base * dr.valor) / 100);
  }
  return redondear(dr.valor);
}

/**
 * Calcula los totales del documento en CLP enteros.
 *
 * Facturas/notas/guías (33, 56, 61, 52): `MntNeto` = afectos, `MntExe` = exentos,
 * `IVA = round(MntNeto * 19%)`, `MntTotal = MntNeto + MntExe + IVA + impuestos adicionales`.
 *
 * Boletas (39, 41): los precios incluyen IVA. `MntTotal` = suma de líneas (± globales);
 * `MntNeto = round(afecto / 1,19)`, `IVA = afecto - MntNeto`.
 *
 * Tipos 34 y 41: todo es exento (sin IVA).
 *
 * Los descuentos/recargos globales en porcentaje se calculan sobre la suma de las líneas de su
 * base (afecta o exenta) y se aplican de forma independiente (no encadenada).
 */
export function calcularTotales(doc: DocumentoDte): TotalesDte {
  const tipo = doc.idDoc.tipoDte;
  const todoExento = esTipoExento(tipo);

  const montosLineas = doc.detalle.map((l, i) => calcularMontoLinea(l, i + 1));
  let afecto = 0;
  let exento = 0;
  doc.detalle.forEach((l, i) => {
    if (todoExento || l.exento) exento += montosLineas[i];
    else afecto += montosLineas[i];
  });
  const baseAfecta = afecto;
  const baseExenta = exento;

  const montosGlobales = (doc.descuentosRecargos ?? []).map((dr, i) => {
    const sobreExento = todoExento || dr.exento === true;
    const monto = montoGlobal(dr, sobreExento ? baseExenta : baseAfecta, i + 1);
    const signo = dr.tipo === 'D' ? -1 : 1;
    if (sobreExento) exento += signo * monto;
    else afecto += signo * monto;
    return monto;
  });
  if (afecto < 0 || exento < 0) {
    throw new ErrorValidacionDte('Los descuentos globales superan el monto de los ítems');
  }

  let mntNeto: number;
  let iva: number;
  if (esBoleta(tipo)) {
    mntNeto = afecto > 0 ? netoDesdeBruto(afecto) : 0;
    iva = afecto - mntNeto;
  } else {
    mntNeto = afecto;
    iva = calcularIva(mntNeto);
  }

  const mntImpAdicionales = (doc.impuestosAdicionales ?? []).reduce((s, imp) => {
    if (!Number.isInteger(imp.monto) || imp.monto < 0) {
      throw new ErrorValidacionDte(`Impuesto adicional ${imp.codigo}: el monto debe ser un entero no negativo`);
    }
    return s + imp.monto;
  }, 0);

  const esAfecto = mntNeto > 0;
  const mntTotal = esBoleta(tipo)
    ? afecto + exento
    : mntNeto + exento + iva + mntImpAdicionales;

  return {
    mntNeto,
    mntExe: exento,
    tasaIva: esAfecto ? TASA_IVA : 0,
    iva: esAfecto ? iva : 0,
    mntImpAdicionales,
    mntTotal,
    montosLineas,
    montosGlobales,
  };
}
