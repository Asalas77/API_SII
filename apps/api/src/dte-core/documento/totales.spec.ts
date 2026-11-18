import { calcularIva, calcularMontoLinea, calcularTotales, netoDesdeBruto, redondear } from './totales.js';
import { ErrorValidacionDte } from './errores.js';
import type { DocumentoDte, TipoDte } from './tipos.js';
import { documentoDePrueba } from '../testing/documentos-prueba.js';

function doc(tipo: TipoDte, detalle: DocumentoDte['detalle'], extra: Partial<DocumentoDte> = {}): DocumentoDte {
  return { ...documentoDePrueba(tipo), detalle, ...extra };
}

describe('redondeo', () => {
  it('redondea mitades hacia arriba', () => {
    expect(redondear(0.5)).toBe(1);
    expect(redondear(2.5)).toBe(3);
    expect(redondear(1.49999)).toBe(1);
    expect(redondear(1.005 * 1000)).toBe(1005);
  });

  it('IVA = round(neto * 19%) con mitades hacia arriba', () => {
    expect(calcularIva(1000)).toBe(190);
    expect(calcularIva(50)).toBe(10); // 9,5
    expect(calcularIva(10)).toBe(2); // 1,9
    expect(calcularIva(3)).toBe(1); // 0,57
    expect(calcularIva(2)).toBe(0); // 0,38
    expect(calcularIva(250)).toBe(48); // 47,5
  });

  it('neto desde bruto = round(bruto / 1,19)', () => {
    expect(netoDesdeBruto(1190)).toBe(1000);
    expect(netoDesdeBruto(1000)).toBe(840); // 840,34
    expect(netoDesdeBruto(1)).toBe(1); // 0,84
    expect(netoDesdeBruto(100)).toBe(84); // 84,03
    expect(netoDesdeBruto(119_000_000)).toBe(100_000_000);
  });
});

describe('calcularMontoLinea', () => {
  it('cantidad decimal redondeada', () => {
    expect(calcularMontoLinea({ nombre: 'x', cantidad: 2.5, precioUnitario: 101 })).toBe(253); // 252,5
    expect(calcularMontoLinea({ nombre: 'x', cantidad: 0.333, precioUnitario: 1000 })).toBe(333);
  });

  it('descuento por porcentaje (redondeado) y por monto', () => {
    expect(calcularMontoLinea({ nombre: 'x', cantidad: 1, precioUnitario: 1005, descuentoPorcentaje: 10 })).toBe(904); // 100,5 -> 101
    expect(calcularMontoLinea({ nombre: 'x', cantidad: 3, precioUnitario: 1000, descuentoMonto: 500 })).toBe(2500);
  });

  it('valida datos', () => {
    expect(() => calcularMontoLinea({ nombre: 'x', cantidad: 0, precioUnitario: 1 })).toThrow(ErrorValidacionDte);
    expect(() => calcularMontoLinea({ nombre: 'x', cantidad: 1, precioUnitario: -1 })).toThrow(/negativo/);
    expect(() =>
      calcularMontoLinea({ nombre: 'x', cantidad: 1, precioUnitario: 10, descuentoMonto: 1, descuentoPorcentaje: 1 }),
    ).toThrow(/no ambos/);
    expect(() => calcularMontoLinea({ nombre: 'x', cantidad: 1, precioUnitario: 10, descuentoMonto: 11 })).toThrow(/supera/);
  });
});

describe('calcularTotales: facturas y notas', () => {
  it('mezcla de afectos y exentos', () => {
    const t = calcularTotales(
      doc(33, [
        { nombre: 'A', cantidad: 2, precioUnitario: 1000 },
        { nombre: 'B', cantidad: 1, precioUnitario: 500 },
        { nombre: 'C', cantidad: 1, precioUnitario: 3000, exento: true },
      ]),
    );
    expect(t).toMatchObject({ mntNeto: 2500, mntExe: 3000, tasaIva: 19, iva: 475, mntTotal: 5975 });
    expect(t.montosLineas).toEqual([2000, 500, 3000]);
  });

  it('IVA con redondeo x.5 hacia arriba', () => {
    const t = calcularTotales(doc(33, [{ nombre: 'A', cantidad: 1, precioUnitario: 250 }]));
    expect(t.iva).toBe(48);
    expect(t.mntTotal).toBe(298);
  });

  it('descuento global por porcentaje y por monto sobre los afectos', () => {
    const t = calcularTotales(
      doc(
        33,
        [
          { nombre: 'A', cantidad: 1, precioUnitario: 10_000 },
          { nombre: 'B', cantidad: 1, precioUnitario: 2000, exento: true },
        ],
        {
          descuentosRecargos: [
            { tipo: 'D', tipoValor: '%', valor: 10 },
            { tipo: 'D', tipoValor: '$', valor: 500 },
          ],
        },
      ),
    );
    expect(t.montosGlobales).toEqual([1000, 500]);
    expect(t).toMatchObject({ mntNeto: 8500, mntExe: 2000, iva: 1615, mntTotal: 12_115 });
  });

  it('recargo global y descuento global sobre exentos', () => {
    const t = calcularTotales(
      doc(
        33,
        [
          { nombre: 'A', cantidad: 1, precioUnitario: 1000 },
          { nombre: 'B', cantidad: 1, precioUnitario: 1000, exento: true },
        ],
        {
          descuentosRecargos: [
            { tipo: 'R', tipoValor: '$', valor: 100 },
            { tipo: 'D', tipoValor: '%', valor: 50, exento: true },
          ],
        },
      ),
    );
    expect(t).toMatchObject({ mntNeto: 1100, mntExe: 500, iva: 209, mntTotal: 1809 });
  });

  it('impuestos adicionales se suman al total', () => {
    const t = calcularTotales(
      doc(33, [{ nombre: 'A', cantidad: 1, precioUnitario: 1000 }], {
        impuestosAdicionales: [{ codigo: 27, tasa: 18, monto: 180 }],
      }),
    );
    expect(t.mntTotal).toBe(1000 + 190 + 180);
    expect(t.mntImpAdicionales).toBe(180);
  });

  it('factura exenta 34: todo exento y sin IVA', () => {
    const t = calcularTotales(doc(34, [{ nombre: 'A', cantidad: 3, precioUnitario: 1000 }]));
    expect(t).toMatchObject({ mntNeto: 0, mntExe: 3000, tasaIva: 0, iva: 0, mntTotal: 3000 });
  });

  it('nota 61 con monto cero (corrección de texto)', () => {
    const t = calcularTotales(doc(61, [{ nombre: 'Corrige giro', cantidad: 1, precioUnitario: 0 }]));
    expect(t).toMatchObject({ mntNeto: 0, mntExe: 0, iva: 0, mntTotal: 0 });
  });

  it('descuentos globales que superan los ítems fallan', () => {
    expect(() =>
      calcularTotales(
        doc(33, [{ nombre: 'A', cantidad: 1, precioUnitario: 100 }], {
          descuentosRecargos: [{ tipo: 'D', tipoValor: '$', valor: 101 }],
        }),
      ),
    ).toThrow(/superan/);
  });
});

describe('calcularTotales: boletas (precios con IVA incluido)', () => {
  it('boleta 39: total = suma de líneas, neto = round(total/1,19), IVA por diferencia', () => {
    const t = calcularTotales(
      doc(39, [
        { nombre: 'A', cantidad: 2, precioUnitario: 595 },
        { nombre: 'B', cantidad: 1, precioUnitario: 1000 },
      ]),
    );
    expect(t).toMatchObject({ mntTotal: 2190, mntNeto: 1840, iva: 350, mntExe: 0 });
    expect(t.mntNeto + t.iva).toBe(t.mntTotal);
  });

  it('boleta 39 con ítem exento: neto/IVA solo sobre lo afecto', () => {
    const t = calcularTotales(
      doc(39, [
        { nombre: 'A', cantidad: 1, precioUnitario: 1190 },
        { nombre: 'B', cantidad: 1, precioUnitario: 500, exento: true },
      ]),
    );
    expect(t).toMatchObject({ mntNeto: 1000, iva: 190, mntExe: 500, mntTotal: 1690 });
  });

  it('boleta 41: todo exento', () => {
    const t = calcularTotales(doc(41, [{ nombre: 'A', cantidad: 2, precioUnitario: 750 }]));
    expect(t).toMatchObject({ mntNeto: 0, iva: 0, tasaIva: 0, mntExe: 1500, mntTotal: 1500 });
  });

  it('descuento por porcentaje en línea de boleta', () => {
    const t = calcularTotales(doc(39, [{ nombre: 'A', cantidad: 1, precioUnitario: 1000, descuentoPorcentaje: 15 }]));
    expect(t.montosLineas).toEqual([850]);
    expect(t).toMatchObject({ mntTotal: 850, mntNeto: 714, iva: 136 });
  });
});
