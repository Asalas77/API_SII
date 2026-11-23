import {
  documentoADetalleGuia,
  documentoADetalleVenta,
  entraAlLibro,
  rangoPeriodo,
  resumenesDeBoletas,
  totalesDeXml,
  type DocumentoParaLibro,
} from './libros-desde-documentos.js';
import { parsearComprasSet } from '../certificacion/libros-set.js';

const xmlFactura =
  '<DTE><Documento><Encabezado><IdDoc><TipoDTE>33</TipoDTE><Folio>5</Folio></IdDoc>' +
  '<Totales><MntNeto>10000</MntNeto><MntExe>500</MntExe><TasaIVA>19.00</TasaIVA><IVA>1900</IVA>' +
  '<ImptoReten><TipoImp>28</TipoImp><TasaImp>6.00</TasaImp><MontoImp>600</MontoImp></ImptoReten>' +
  '<MntTotal>13000</MntTotal></Totales></Encabezado>' +
  '<Referencia><NroLinRef>1</NroLinRef><TpoDocRef>SET</TpoDocRef><FolioRef>1</FolioRef><RazonRef>CASO 1-1</RazonRef></Referencia>' +
  '<Referencia><NroLinRef>2</NroLinRef><TpoDocRef>33</TpoDocRef><FolioRef>4</FolioRef><FchRef>2026-01-02</FchRef><CodRef>1</CodRef></Referencia>' +
  '</Documento></DTE>';

const base = (extra: Partial<DocumentoParaLibro>): DocumentoParaLibro => ({
  tipoDte: 33,
  folio: 5,
  fechaEmision: '2026-01-10',
  estado: 'emitido',
  rutReceptor: 12345678,
  dvReceptor: '5',
  razonSocialReceptor: 'Cliente',
  montoNeto: 10000,
  montoExento: 500,
  iva: 1900,
  montoTotal: 13000,
  xmlFirmado: xmlFactura,
  ...extra,
});

describe('rangoPeriodo', () => {
  it('calcula primer y último día, incluso febrero bisiesto', () => {
    expect(rangoPeriodo('2026-11')).toEqual({ desde: '2026-11-01', hasta: '2026-11-30' });
    expect(rangoPeriodo('2028-02')).toEqual({ desde: '2028-02-01', hasta: '2028-02-29' });
    expect(rangoPeriodo('2026-12').hasta).toBe('2026-12-31');
  });
});

describe('totalesDeXml', () => {
  it('lee montos, tasa e impuestos adicionales del bloque Totales', () => {
    expect(totalesDeXml(xmlFactura)).toEqual({
      neto: 10000,
      exento: 500,
      iva: 1900,
      tasaIva: 19,
      impuestos: [{ codigo: 28, tasa: 6, monto: 600 }],
    });
  });
});

describe('documentoADetalleVenta', () => {
  it('usa las columnas y toma los impuestos adicionales del XML', () => {
    const d = documentoADetalleVenta(base({}));
    expect(d).toMatchObject({
      tipoDoc: 33,
      folio: 5,
      fechaDoc: '2026-01-10',
      rutContraparte: '12345678-5',
      montoNeto: 10000,
      montoExento: 500,
      montoIva: 1900,
      montoTotal: 13000,
      otrosImpuestos: [{ codigo: 28, tasa: 6, monto: 600 }],
    });
  });

  it('si faltan columnas usa el XML; el folio anulado se informa solo con tipo y folio', () => {
    const d = documentoADetalleVenta(base({ montoNeto: null, montoExento: null, iva: null }));
    expect(d).toMatchObject({ montoNeto: 10000, montoExento: 500, montoIva: 1900 });
    expect(documentoADetalleVenta(base({ estado: 'anulado' }))).toEqual({ tipoDoc: 33, folio: 5, anulado: true });
  });

  it('nota de crédito que anula informa el documento anulado (ignora la referencia SET)', () => {
    const d = documentoADetalleVenta(base({ tipoDte: 61 }));
    expect(d).toMatchObject({ tipoDocRef: 33, folioDocRef: 4 });
  });

  it('un documento rechazado no entra al libro', () => {
    expect(entraAlLibro({ estado: 'rechazado' })).toBe(false);
    expect(entraAlLibro({ estado: 'aceptado_con_reparos' })).toBe(true);
  });
});

describe('resumenesDeBoletas', () => {
  it('agrupa por tipo; los anulados cuentan pero no suman', () => {
    const boleta = (folio: number, extra: Partial<DocumentoParaLibro> = {}) =>
      base({ tipoDte: 39, folio, montoExento: null, montoNeto: 8403, iva: 1597, montoTotal: 10000, xmlFirmado: '', ...extra });
    const r = resumenesDeBoletas([boleta(1), boleta(2), boleta(3, { estado: 'anulado' })]);
    expect(r).toEqual([
      { tipoDoc: 39, cantidad: 3, cantidadAnulados: 1, montoExento: 0, montoNeto: 16806, montoIva: 3194, montoTotal: 20000 },
    ]);
  });
});

describe('documentoADetalleGuia', () => {
  const guiaXml = (traslado: number) =>
    `<DTE><IdDoc><TipoDTE>52</TipoDTE><IndTraslado>${traslado}</IndTraslado></IdDoc><Totales><MntTotal>500</MntTotal></Totales>` +
    '<Referencia><NroLinRef>1</NroLinRef><TpoDocRef>33</TpoDocRef><FolioRef>9</FolioRef><FchRef>2026-01-11</FchRef></Referencia></DTE>';
  const guia = (traslado: number, extra: Partial<DocumentoParaLibro> = {}) =>
    base({ tipoDte: 52, montoNeto: null, montoExento: null, iva: null, montoTotal: 500, xmlFirmado: guiaXml(traslado), ...extra });

  it('mapea IndTraslado a TpoOper y toma la factura asociada', () => {
    expect(documentoADetalleGuia(guia(1))).toMatchObject({
      folio: 5,
      tipoOperacion: 1,
      montoTotal: 500,
      tipoDocRef: 33,
      folioDocRef: 9,
      fechaDocRef: '2026-01-11',
    });
    expect(documentoADetalleGuia(guia(8)).tipoOperacion).toBe(6);
    expect(documentoADetalleGuia(guia(9)).tipoOperacion).toBe(1);
    expect(documentoADetalleGuia(guia(5)).tipoOperacion).toBe(5);
  });

  it('Res. 144: 10 a 12 (el libro solo define 1 a 7; mapeo supuesto)', () => {
    expect(documentoADetalleGuia(guia(10)).tipoOperacion).toBe(6);
    expect(documentoADetalleGuia(guia(11)).tipoOperacion).toBe(1);
    expect(documentoADetalleGuia(guia(12)).tipoOperacion).toBe(6);
  });

  it('folio anulado', () => {
    expect(documentoADetalleGuia(guia(1, { estado: 'anulado' }))).toEqual({ folio: 5, anulado: 1 });
  });
});

describe('parsearComprasSet', () => {
  it('valida el JSON del set de compras', () => {
    const r = parsearComprasSet(
      JSON.stringify({
        factorProporcionalidad: 0.6,
        documentos: [{ tipoDoc: 30, folio: 1, fechaDoc: '2026-01-05', rutProveedor: '96792430-K', montoNeto: 100 }],
      }),
    );
    expect(r.documentos).toHaveLength(1);
    expect(r.factorProporcionalidad).toBe(0.6);
    expect(() => parsearComprasSet('{"documentos":[]}')).toThrow(/inválido/);
    expect(() => parsearComprasSet('no es json')).toThrow(/inválido/);
  });
});

describe('documentos de exportación en el libro de ventas', () => {
  const xmlExp = (tipo: number, refs = '') =>
    `<DTE><Exportaciones><Encabezado><IdDoc><TipoDTE>${tipo}</TipoDTE><Folio>3</Folio></IdDoc>` +
    '<Receptor><RUTRecep>55555555-5</RUTRecep><Extranjero><NumId>US-1</NumId><Nacionalidad>225</Nacionalidad></Extranjero></Receptor>' +
    '<Totales><TpoMoneda>DOLAR USA</TpoMoneda><MntExe>7192.8317</MntExe><MntTotal>7192.8317</MntTotal></Totales></Encabezado>' +
    `${refs}</Exportaciones></DTE>`;

  it('informa montos en pesos (columnas), receptor extranjero y sin IVA', () => {
    const d = documentoADetalleVenta(
      base({ tipoDte: 110, rutReceptor: 55555555, dvReceptor: '5', montoNeto: 0, montoExento: 6656654, iva: 0, montoTotal: 6656654, xmlFirmado: xmlExp(110) }),
    );
    expect(d).toMatchObject({
      tipoDoc: 110,
      montoExento: 6656654,
      montoIva: 0,
      montoTotal: 6656654,
      rutContraparte: '55555555-5',
      extranjero: { numId: 'US-1', nacionalidad: '225' },
    });
    expect(d.montoNeto).toBeUndefined();
    expect(d.tasaIva).toBeUndefined();
  });

  it('la nota 112 que anula (codRef 1) informa el documento anulado', () => {
    const refs = '<Referencia><NroLinRef>1</NroLinRef><TpoDocRef>110</TpoDocRef><FolioRef>1</FolioRef><FchRef>2026-01-02</FchRef><CodRef>1</CodRef></Referencia>';
    const d = documentoADetalleVenta(base({ tipoDte: 112, montoNeto: 0, montoExento: 100, iva: 0, montoTotal: 100, xmlFirmado: xmlExp(112, refs) }));
    expect(d).toMatchObject({ tipoDoc: 112, tipoDocRef: 110, folioDocRef: 1 });
  });
});
