import { casoADocumento, receptoresDePrueba } from './generador.js';
import { parsearSet, parsearSetJson, parsearSetTexto } from './index.js';
import { validarRut } from '../dte-core/index.js';

/** Ejemplo representativo (inventado) del texto del set básico del SII. */
const SET_TEXTO = `SET BASICO - NUMERO DE ATENCION: 4321

CASO 4321-1
===========
DOCUMENTO\tFACTURA ELECTRONICA
ITEM\tCANTIDAD\tPRECIO UNITARIO
Cajón AFECTO\t224\t4617
Relleno EXENTO\t174\t2.205

CASO 4321-2
===========
DOCUMENTO\tFACTURA ELECTRONICA
ITEM\tCANTIDAD\tPRECIO UNITARIO\tDESCUENTO
Pañuelo de papel   30   1500   10%
DESCUENTO GLOBAL 5%

CASO 4321-3
===========
DOCUMENTO\tNOTA DE CREDITO ELECTRONICA
REFERENCIA\tANULA FACTURA ELECTRONICA NO. 1
RAZON REFERENCIA\tANULA FACTURA

CASO 4321-4
DOCUMENTO\tNOTA DE CREDITO ELECTRONICA
REFERENCIA\tCORRIGE TEXTO FACTURA CASO 4321-2
RAZON REFERENCIA\tCORRIGE GIRO DEL RECEPTOR

CASO 4321-5
DOCUMENTO\tGUIA DE DESPACHO ELECTRONICA
TRASLADO\tOPERACION CONSTITUYE VENTA
ITEM\tCANTIDAD\tPRECIO UNITARIO
Mercadería\t10\t1000
`;

describe('parsearSetTexto', () => {
  const set = parsearSetTexto(SET_TEXTO);

  it('reconoce número de atención, casos y tipos', () => {
    expect(set.numeroAtencion).toBe('4321');
    expect(set.casos.map((c) => [c.id, c.tipoDte])).toEqual([
      ['4321-1', 33],
      ['4321-2', 33],
      ['4321-3', 61],
      ['4321-4', 61],
      ['4321-5', 52],
    ]);
  });

  it('lee ítems con glosa exacta, acentos, miles y exentos', () => {
    expect(set.casos[0].items).toEqual([
      { nombre: 'Cajón AFECTO', cantidad: 224, precioUnitario: 4617 },
      { nombre: 'Relleno EXENTO', cantidad: 174, precioUnitario: 2205, exento: true },
    ]);
  });

  it('lee descuento por ítem, filas con espacios y descuento global', () => {
    expect(set.casos[1].items[0]).toMatchObject({
      nombre: 'Pañuelo de papel',
      cantidad: 30,
      precioUnitario: 1500,
      descuentoPorcentaje: 10,
    });
    expect(set.casos[1].descuentoGlobalPorcentaje).toBe(5);
  });

  it('interpreta referencias y traslado', () => {
    expect(set.casos[2].referencias[0]).toMatchObject({ caso: '4321-1', codRef: 1, razonRef: 'ANULA FACTURA' });
    expect(set.casos[3].referencias[0]).toMatchObject({ caso: '4321-2', codRef: 2 });
    expect(set.casos[4].indTraslado).toBe(1);
    expect(set.advertencias).toEqual([]);
  });

  it('advierte de líneas no interpretadas y falla sin casos', () => {
    const s = parsearSetTexto('CASO 1-1\nDOCUMENTO FACTURA ELECTRONICA\nalgo raro sin numeros\n');
    expect(s.advertencias.some((a) => a.includes('algo raro'))).toBe(true);
    expect(() => parsearSetTexto('nada')).toThrow(/ningún/);
  });
});

describe('parsearSetJson / parsearSet', () => {
  const json = JSON.stringify({
    numeroAtencion: 4321,
    casos: [
      { id: '4321-1', tipoDte: 39, items: [{ nombre: 'Café', cantidad: 2, precioUnitario: 1500 }] },
    ],
  });

  it('valida y normaliza el JSON', () => {
    const s = parsearSetJson(json);
    expect(s.numeroAtencion).toBe('4321');
    expect(s.casos[0]).toMatchObject({ numero: 1, referencias: [], tipoDte: 39 });
  });

  it('rechaza JSON inválido y autodetecta el formato', () => {
    expect(() => parsearSetJson('{"casos":[]}')).toThrow(/inválido/);
    expect(parsearSet(json).casos).toHaveLength(1);
    expect(parsearSet(SET_TEXTO).casos).toHaveLength(5);
  });
});

describe('casoADocumento', () => {
  const set = parsearSetTexto(SET_TEXTO);
  const [receptor] = receptoresDePrueba(1);
  const emitidos = new Map([
    ['4321-1', { tipoDte: 33, folio: 7, fechaEmision: '2026-11-18', items: set.casos[0].items }],
  ]);
  const ctx = { fechaEmision: '2026-11-18', receptor, emitidos };

  it('pone SET / CASO como primera referencia', () => {
    const dto = casoADocumento(set.casos[0], ctx);
    expect(dto.referencias?.[0]).toMatchObject({ tipoDocRef: 'SET', razonRef: 'CASO 4321-1' });
    expect(dto.receptor?.rut).toBe(receptor.rut);
  });

  it('una anulación referencia el folio emitido y copia los ítems', () => {
    const dto = casoADocumento(set.casos[2], ctx);
    expect(dto.referencias).toHaveLength(2);
    expect(dto.referencias?.[1]).toMatchObject({ tipoDocRef: '33', folioRef: 7, codRef: 1 });
    expect(dto.detalle).toHaveLength(2);
  });

  it('falla si el caso referenciado no se emitió', () => {
    expect(() => casoADocumento(set.casos[3], ctx)).toThrow(/4321-2/);
  });

  it('guías llevan indTraslado y descuento global se traduce', () => {
    expect(casoADocumento(set.casos[4], ctx).idDoc.indTraslado).toBe(1);
    expect(casoADocumento(set.casos[1], ctx).descuentosRecargos?.[0]).toMatchObject({ tipo: 'D', valor: 5 });
  });
});

describe('receptoresDePrueba', () => {
  it('genera RUT válidos y distintos', () => {
    const r = receptoresDePrueba(20);
    expect(new Set(r.map((x) => x.rut)).size).toBe(20);
    expect(r.every((x) => validarRut(x.rut))).toBe(true);
  });
});

describe('set de exportación (JSON)', () => {
  const SET_EXP = JSON.stringify({
    numeroAtencion: '4400',
    casos: [
      {
        id: '4400-1',
        tipoDte: 110,
        receptorExtranjero: { razonSocial: 'ACME IMPORT INC', direccion: '350 Fifth Avenue, New York' },
        items: [{ nombre: 'Vino Cabernet Sauvignon', cantidad: 100, precioUnitario: 45.5 }],
        exportacion: {
          moneda: 'DOLAR USA',
          tipoCambio: 925.45,
          extranjero: { nacionalidad: 225 },
          aduana: { codigoClausulaVenta: 5, codigoViaTransporte: 1, totalBultos: 10, codigoPaisReceptor: 225 },
        },
      },
      {
        id: '4400-2',
        tipoDte: 112,
        referencias: [{ caso: '4400-1', codRef: 1, razonRef: 'ANULA FACTURA DE EXPORTACION' }],
        receptorExtranjero: { razonSocial: 'ACME IMPORT INC', direccion: '350 Fifth Avenue, New York' },
        exportacion: { moneda: 'DOLAR USA', tipoCambio: 925.45, extranjero: { nacionalidad: 225 } },
        items: [],
      },
      { id: '4400-3', tipoDte: 110, items: [{ nombre: 'X', cantidad: 1, precioUnitario: 1 }] },
    ],
  });

  it('parsea los casos de exportación y arma el cuerpo de emisión sin IVA ni forma de pago', () => {
    const set = parsearSet(SET_EXP);
    const ctx = { fechaEmision: '2026-11-23', receptor: { rut: '12345678-5', razonSocial: 'X' }, emitidos: new Map() };
    const dto = casoADocumento(set.casos[0], ctx);
    expect(dto.idDoc).toEqual({ tipoDte: 110, fechaEmision: '2026-11-23' });
    expect(dto.receptor).toEqual({ razonSocial: 'ACME IMPORT INC', direccion: '350 Fifth Avenue, New York' });
    expect(dto.exportacion?.moneda).toBe('DOLAR USA');
    expect(dto.referencias?.[0]).toMatchObject({ tipoDocRef: 'SET', razonRef: 'CASO 4400-1' });
    expect(dto.detalle[0]).toMatchObject({ cantidad: 100, precioUnitario: 45.5 });
  });

  it('la nota 112 referencia el caso emitido y repite los ítems al anular; un caso 110 sin exportación falla', () => {
    const set = parsearSet(SET_EXP);
    const emitidos = new Map([['4400-1', { tipoDte: 110, folio: 3, fechaEmision: '2026-11-23', items: set.casos[0].items }]]);
    const ctx = { fechaEmision: '2026-11-23', receptor: { rut: '12345678-5', razonSocial: 'X' }, emitidos };
    const nota = casoADocumento(set.casos[1], ctx);
    expect(nota.referencias?.[1]).toMatchObject({ tipoDocRef: '110', folioRef: 3, codRef: 1 });
    expect(nota.detalle).toHaveLength(1);
    expect(() => casoADocumento(set.casos[2], ctx)).toThrow(/exportacion/);
  });
});
