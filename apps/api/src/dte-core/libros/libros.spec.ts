import { verificarFirmaXml } from '../firma/firma.js';
import { generarCertificadoPrueba } from '../testing/testing.js';
import { desdeIso88591 } from '../xml/xml.util.js';
import { validarXsd, type EsquemaSii } from '../xsd/xsd.js';
import {
  type CaratulaLibroCV,
  construirLibroCompraVenta,
  type DetalleLibroCV,
} from './libro-cv.js';
import { type CaratulaLibroGuias, construirLibroGuias, type DetalleLibroGuias } from './libro-guias.js';

const certificado = generarCertificadoPrueba({ rut: '12345678-5' });
const fechaFirma = new Date('2026-02-01T13:00:00Z');

function esperarValido(xmlIso: Buffer, esquema: EsquemaSii): void {
  const r = validarXsd(xmlIso, esquema);
  expect(r.valido, `Errores XSD (${esquema}):\n${r.errores.join('\n')}`).toBe(true);
  const f = verificarFirmaXml(desdeIso88591(xmlIso));
  expect(f.valida, f.errores.join('\n')).toBe(true);
}

const caratulaVentas: CaratulaLibroCV = {
  rutEmisorLibro: '76086428-5',
  rutEnvia: '12345678-5',
  periodoTributario: '2026-01',
  fechaResolucion: '2025-01-15',
  numeroResolucion: 80,
  tipoOperacion: 'VENTA',
  tipoLibro: 'ESPECIAL',
  tipoEnvio: 'TOTAL',
  folioNotificacion: 1,
};

const venta = (extra: Partial<DetalleLibroCV>): DetalleLibroCV => ({
  tipoDoc: 33,
  folio: 1,
  fechaDoc: '2026-01-20',
  rutContraparte: '12345678-5',
  razonSocial: 'Cliente de prueba Ñandú Ltda',
  ...extra,
});

describe('construirLibroCompraVenta - ventas', () => {
  const detalle: DetalleLibroCV[] = [
    venta({ folio: 1, montoNeto: 10000, montoExento: 2000 }),
    venta({ folio: 2, montoNeto: 5000 }),
    venta({ tipoDoc: 34, folio: 1, montoExento: 3000, rutContraparte: '11111111-1' }),
    venta({ tipoDoc: 56, folio: 1, montoNeto: 1000 }),
    venta({ tipoDoc: 61, folio: 1, montoNeto: 4000, tipoDocRef: 33, folioDocRef: 1 }),
    { tipoDoc: 33, folio: 3, anulado: true },
  ];

  it('totaliza por tipo (IVA 19 %, exentos, anulados) y valida contra el XSD con firma verificable', () => {
    const libro = construirLibroCompraVenta({ caratula: caratulaVentas, detalle, certificado, fechaFirma });
    esperarValido(libro.xmlIso, 'LibroCV');
    const por = new Map(libro.resumenPeriodo?.map((t) => [t.tipoDoc, t]));
    expect(por.get(33)).toMatchObject({
      cantidad: 3,
      anulados: 1,
      montoExento: 2000,
      montoNeto: 15000,
      montoIva: 2850,
      montoTotal: 19850,
    });
    expect(por.get(34)).toMatchObject({ cantidad: 1, montoExento: 3000, montoNeto: 0, montoIva: 0, montoTotal: 3000 });
    expect(por.get(56)).toMatchObject({ montoNeto: 1000, montoIva: 190, montoTotal: 1190 });
    expect(por.get(61)).toMatchObject({ montoNeto: 4000, montoIva: 760, montoTotal: 4760 });
    expect(libro.cantidadDetalle).toBe(6);
  });

  it('las notas de crédito restan en el saldo; el XML las lleva en positivo por tipo', () => {
    const libro = construirLibroCompraVenta({ caratula: caratulaVentas, detalle, certificado, fechaFirma });
    // 33: 19850 + 34: 3000 + 56: 1190 - 61: 4760
    expect(libro.saldo).toEqual({ montoExento: 5000, montoNeto: 12000, montoIva: 2280, montoTotal: 19280 });
    expect(libro.xml).toMatch(/<TotalesPeriodo><TpoDoc>61<\/TpoDoc><TotDoc>1<\/TotDoc>.*<TotMntNeto>4000<\/TotMntNeto>/);
  });

  it('el folio anulado solo informa tipo, folio y la marca A; no suma montos', () => {
    const libro = construirLibroCompraVenta({ caratula: caratulaVentas, detalle, certificado, fechaFirma });
    expect(libro.xml).toContain('<Detalle><TpoDoc>33</TpoDoc><NroDoc>3</NroDoc><Anulado>A</Anulado></Detalle>');
    expect(libro.xml).toContain('<TotAnulado>1</TotAnulado>');
  });

  it('carátula con ESPECIAL + FolioNotificacion; XML firmado en el elemento EnvioLibro', () => {
    const libro = construirLibroCompraVenta({ caratula: caratulaVentas, detalle, certificado, fechaFirma });
    expect(libro.xml).toContain('<TipoOperacion>VENTA</TipoOperacion><TipoLibro>ESPECIAL</TipoLibro><TipoEnvio>TOTAL</TipoEnvio><FolioNotificacion>1</FolioNotificacion>');
    expect(libro.xml).toContain(`<EnvioLibro ID="${libro.idEnvio}">`);
    expect(libro.xml).toContain(`URI="#${libro.idEnvio}"`);
    expect(libro.xml).toContain('<TmstFirma>2026-02-01T10:00:00</TmstFirma>');
    expect(libro.xmlIso.subarray(0, 60).toString('latin1')).toContain('encoding="ISO-8859-1"');
    // Ñ viaja como un solo byte en ISO-8859-1.
    expect(libro.xmlIso.includes(0xd1)).toBe(true);
  });

  it('boletas como resumen adicional van solo en ResumenPeriodo (no en el detalle)', () => {
    const libro = construirLibroCompraVenta({
      caratula: { ...caratulaVentas, tipoLibro: 'MENSUAL', folioNotificacion: undefined },
      detalle: [venta({ montoNeto: 1000 })],
      resumenesAdicionales: [{ tipoDoc: 39, cantidad: 10, montoExento: 0, montoNeto: 8403, montoIva: 1597, montoTotal: 10000 }],
      certificado,
      fechaFirma,
    });
    esperarValido(libro.xmlIso, 'LibroCV');
    expect(libro.resumenPeriodo?.map((t) => t.tipoDoc)).toEqual([33, 39]);
    expect(libro.cantidadDetalle).toBe(1);
  });

  it('rechaza tipos solo-resumen en el detalle, totales que no cuadran, RUT malos y ESPECIAL sin folio', () => {
    const base = { caratula: caratulaVentas, certificado, fechaFirma };
    expect(() => construirLibroCompraVenta({ ...base, detalle: [venta({ tipoDoc: 39, montoNeto: 1 })] })).toThrow(/resumen/);
    expect(() => construirLibroCompraVenta({ ...base, detalle: [venta({ montoNeto: 1000, montoTotal: 1 })] })).toThrow(/no cuadra/);
    expect(() => construirLibroCompraVenta({ ...base, detalle: [venta({ rutContraparte: '12345678-0', montoNeto: 1 })] })).toThrow(/RUT/);
    expect(() =>
      construirLibroCompraVenta({ ...base, caratula: { ...caratulaVentas, folioNotificacion: undefined }, detalle }),
    ).toThrow(/FolioNotificacion/);
    expect(() => construirLibroCompraVenta({ ...base, detalle: [venta({}), venta({})] })).toThrow(/repetido/);
  });

  it('libro sin documentos: solo carátula (válido contra el XSD)', () => {
    const libro = construirLibroCompraVenta({ caratula: caratulaVentas, detalle: [], certificado, fechaFirma });
    esperarValido(libro.xmlIso, 'LibroCV');
    expect(libro.resumenPeriodo).toBeNull();
    expect(libro.advertencias[0]).toMatch(/solo la carátula/);
  });
});

describe('construirLibroCompraVenta - compras', () => {
  const caratula: CaratulaLibroCV = { ...caratulaVentas, tipoOperacion: 'COMPRA', folioNotificacion: 2 };
  const compra = (extra: Partial<DetalleLibroCV>): DetalleLibroCV => ({
    tipoDoc: 33,
    folio: 100,
    fechaDoc: '2026-01-10',
    rutContraparte: '96792430-K',
    razonSocial: 'Proveedor SA',
    ...extra,
  });

  const detalle: DetalleLibroCV[] = [
    compra({ folio: 100, montoNeto: 10000 }),
    compra({ folio: 101, montoNeto: 20000, montoIva: 0, ivaUsoComun: 3800 }),
    compra({ folio: 102, montoNeto: 5000, montoIva: 0, ivaNoRecuperable: [{ codigo: 1, monto: 950 }] }),
    compra({ folio: 103, montoNeto: 8000, montoNetoActivoFijo: 8000, ivaActivoFijo: 1520 }),
    compra({ tipoDoc: 34, folio: 7, montoExento: 6000 }),
    compra({ tipoDoc: 61, folio: 20, montoNeto: 2000, tipoDocRef: 33, folioDocRef: 100 }),
    compra({ folio: 104, montoNeto: 10000, otrosImpuestos: [{ codigo: 28, tasa: 6, monto: 600 }], impuestoSinCredito: 200 }),
  ];

  it('IVA recuperable, uso común, no recuperable, activo fijo y otros impuestos: totales y XSD', () => {
    const libro = construirLibroCompraVenta({ caratula, detalle, factorProporcionalidad: 0.6, certificado, fechaFirma });
    esperarValido(libro.xmlIso, 'LibroCV');
    const t33 = libro.resumenPeriodo?.find((t) => t.tipoDoc === 33);
    expect(t33).toMatchObject({
      cantidad: 5,
      montoNeto: 53000,
      montoIva: 1900 + 1520 + 1900,
      ivaUsoComun: 3800,
      impuestoSinCredito: 200,
    });
    expect(t33?.ivaNoRecuperable).toEqual([{ codigo: 1, cantidad: 1, monto: 950 }]);
    expect(t33?.otrosImpuestos).toEqual([{ codigo: 28, monto: 600 }]);
    // 11900 + 23800 + 5950 + 9520 + 12700
    expect(t33?.montoTotal).toBe(63870);
    expect(libro.xml).toContain('<FctProp>0.600</FctProp><TotCredIVAUsoComun>2280</TotCredIVAUsoComun>');
    expect(libro.xml).toContain('<IVANoRec><CodIVANoRec>1</CodIVANoRec><MntIVANoRec>950</MntIVANoRec></IVANoRec>');
    expect(libro.xml).toContain('<OtrosImp><CodImp>28</CodImp><TasaImp>6</TasaImp><MntImp>600</MntImp></OtrosImp>');
  });

  it('factura exenta: IVA 0 informado y total = exento', () => {
    const libro = construirLibroCompraVenta({ caratula, detalle, certificado, fechaFirma });
    expect(libro.xml).toContain('<NroDoc>7</NroDoc>');
    expect(libro.xml).toMatch(/<NroDoc>7<\/NroDoc><FchDoc>2026-01-10<\/FchDoc><RUTDoc>96792430-K<\/RUTDoc><RznSoc>Proveedor SA<\/RznSoc><MntExe>6000<\/MntExe><MntIVA>0<\/MntIVA><MntTotal>6000<\/MntTotal>/);
  });

  it('el factor de proporcionalidad solo aplica a compras y debe estar en rango', () => {
    expect(() =>
      construirLibroCompraVenta({ caratula: caratulaVentas, detalle: [], factorProporcionalidad: 0.5, certificado }),
    ).toThrow(/solo aplica a compras/);
    expect(() => construirLibroCompraVenta({ caratula, detalle, factorProporcionalidad: 0, certificado })).toThrow(/entre/);
  });

  it('rechaza códigos de IVA no recuperable inválidos', () => {
    expect(() =>
      construirLibroCompraVenta({
        caratula,
        detalle: [compra({ montoNeto: 100, ivaNoRecuperable: [{ codigo: 7 as 1, monto: 1 }] })],
        certificado,
      }),
    ).toThrow(/no recuperable/);
  });
});

describe('construirLibroCompraVenta - tipos de envío', () => {
  const caratula = caratulaVentas;
  const docs = [venta({ folio: 1, montoNeto: 1000 }), venta({ folio: 2, montoNeto: 2000 })];

  it('PARCIAL: ResumenSegmento + Detalle, sin ResumenPeriodo', () => {
    const libro = construirLibroCompraVenta({
      caratula: { ...caratula, tipoEnvio: 'PARCIAL', nroSegmento: 1 },
      detalle: docs,
      certificado,
      fechaFirma,
    });
    esperarValido(libro.xmlIso, 'LibroCV');
    expect(libro.xml).toContain('<ResumenSegmento>');
    expect(libro.xml).not.toContain('<ResumenPeriodo>');
    expect(() =>
      construirLibroCompraVenta({ caratula: { ...caratula, tipoEnvio: 'PARCIAL' }, detalle: docs, certificado }),
    ).toThrow(/NroSegmento/);
  });

  it('FINAL: solo ResumenPeriodo (sin Detalle)', () => {
    const libro = construirLibroCompraVenta({ caratula: { ...caratula, tipoEnvio: 'FINAL' }, detalle: docs, certificado, fechaFirma });
    esperarValido(libro.xmlIso, 'LibroCV');
    expect(libro.xml).toContain('<ResumenPeriodo>');
    expect(libro.xml).not.toContain('<Detalle>');
    expect(libro.resumenPeriodo?.[0].montoNeto).toBe(3000);
  });

  it('AJUSTE: el segmento lleva signo (elimina resta) y el período sale de documentosPeriodo', () => {
    const libro = construirLibroCompraVenta({
      caratula: { ...caratula, tipoEnvio: 'AJUSTE' },
      detalle: [venta({ folio: 2, montoNeto: 2000, operacion: 2 }), venta({ folio: 2, tipoDoc: 61, montoNeto: 2000, operacion: 1 })],
      documentosPeriodo: [venta({ folio: 1, montoNeto: 1000 }), venta({ folio: 2, tipoDoc: 61, montoNeto: 2000 })],
      certificado,
      fechaFirma,
    });
    esperarValido(libro.xmlIso, 'LibroCV');
    const seg33 = libro.resumenSegmento?.find((t) => t.tipoDoc === 33);
    expect(seg33).toMatchObject({ cantidad: -1, montoNeto: -2000, montoIva: -380, montoTotal: -2380 });
    expect(libro.xml).toContain('<TotDoc>-1</TotDoc>');
    expect(libro.xml).toContain('<Operacion>2</Operacion>');
    expect(libro.resumenPeriodo?.map((t) => [t.tipoDoc, t.cantidad])).toEqual([[33, 1], [61, 1]]);
    expect(() =>
      construirLibroCompraVenta({ caratula: { ...caratula, tipoEnvio: 'AJUSTE' }, detalle: docs, certificado }),
    ).toThrow(/documentosPeriodo/);
  });

  it('RECTIFICA exige CodAutRec', () => {
    expect(() =>
      construirLibroCompraVenta({ caratula: { ...caratula, tipoLibro: 'RECTIFICA' }, detalle: docs, certificado }),
    ).toThrow(/CodAutRec/);
    const libro = construirLibroCompraVenta({
      caratula: { ...caratula, tipoLibro: 'RECTIFICA', folioNotificacion: undefined, codAutRec: 'ABC123' },
      detalle: docs,
      certificado,
      fechaFirma,
    });
    esperarValido(libro.xmlIso, 'LibroCV');
  });
});

describe('construirLibroGuias', () => {
  const caratula: CaratulaLibroGuias = {
    rutEmisorLibro: '76086428-5',
    rutEnvia: '12345678-5',
    periodoTributario: '2026-01',
    fechaResolucion: '2025-01-15',
    numeroResolucion: 80,
    tipoLibro: 'ESPECIAL',
    tipoEnvio: 'TOTAL',
    folioNotificacion: 3,
  };
  const guia = (extra: Partial<DetalleLibroGuias>): DetalleLibroGuias => ({
    folio: 1,
    tipoOperacion: 1,
    fechaDoc: '2026-01-15',
    rutReceptor: '12345678-5',
    razonSocial: 'Cliente',
    montoNeto: 1000,
    tasaIva: 19,
    iva: 190,
    montoTotal: 1190,
    tipoDocRef: 33,
    folioDocRef: 10,
    fechaDocRef: '2026-01-16',
    ...extra,
  });
  const detalle: DetalleLibroGuias[] = [
    guia({ folio: 1 }),
    guia({ folio: 2, montoNeto: 2000, iva: 380, montoTotal: 2380 }),
    guia({ folio: 3, tipoOperacion: 5, montoNeto: undefined, iva: undefined, montoTotal: 500, tipoDocRef: undefined, folioDocRef: undefined, fechaDocRef: undefined }),
    guia({ folio: 4, tipoOperacion: 5, montoNeto: undefined, iva: undefined, montoTotal: 300, tipoDocRef: undefined, folioDocRef: undefined, fechaDocRef: undefined }),
    guia({ folio: 5, tipoOperacion: 3, montoNeto: undefined, iva: undefined, montoTotal: undefined, tipoDocRef: undefined, folioDocRef: undefined, fechaDocRef: undefined }),
    { folio: 6, anulado: 1 },
    guia({ folio: 7, anulado: 2 }),
  ];

  it('totaliza ventas, traslados no venta y anuladas; valida XSD (con la copia que importa xmldsig) y firma', () => {
    const libro = construirLibroGuias({ caratula, detalle, certificado, fechaFirma });
    esperarValido(libro.xmlIso, 'LibroGuia');
    expect(libro.resumenPeriodo).toEqual({
      foliosAnulados: 1,
      guiasAnuladas: 1,
      guiasVenta: 2,
      montoGuiasVenta: 3570,
      montoModificado: 0,
      traslados: [
        { tipoOperacion: 3, cantidad: 1, monto: 0 },
        { tipoOperacion: 5, cantidad: 2, monto: 800 },
      ],
    });
    expect(libro.xml).toContain('<Detalle><Folio>6</Folio><Anulado>1</Anulado></Detalle>');
    expect(libro.xml).toContain('<FolioNotificacion>3</FolioNotificacion>');
  });

  it('guías recibidas parcialmente exigen monto modificado; la venta exige receptor', () => {
    expect(() => construirLibroGuias({ caratula, detalle: [guia({ anulado: 3 })], certificado })).toThrow(/montoModificado/);
    expect(() =>
      construirLibroGuias({ caratula, detalle: [guia({ rutReceptor: undefined })], certificado }),
    ).toThrow(/receptor/);
    const ok = construirLibroGuias({ caratula, detalle: [guia({ anulado: 3, montoModificado: 900 })], certificado, fechaFirma });
    esperarValido(ok.xmlIso, 'LibroGuia');
    expect(ok.resumenPeriodo?.montoModificado).toBe(900);
  });

  it('PARCIAL, FINAL y AJUSTE', () => {
    const parcial = construirLibroGuias({
      caratula: { ...caratula, tipoEnvio: 'PARCIAL', nroSegmento: 2 },
      detalle: [guia({ folio: 1 })],
      certificado,
      fechaFirma,
    });
    esperarValido(parcial.xmlIso, 'LibroGuia');
    expect(parcial.xml).toContain('<NroSegmento>2</NroSegmento>');
    const final = construirLibroGuias({ caratula: { ...caratula, tipoEnvio: 'FINAL' }, detalle, certificado, fechaFirma });
    esperarValido(final.xmlIso, 'LibroGuia');
    expect(final.xml).not.toContain('<Detalle>');
    const ajuste = construirLibroGuias({
      caratula: { ...caratula, tipoEnvio: 'AJUSTE' },
      detalle: [guia({ folio: 1, operacion: 2 })],
      guiasPeriodo: [guia({ folio: 2 })],
      certificado,
      fechaFirma,
    });
    esperarValido(ajuste.xmlIso, 'LibroGuia');
    expect(ajuste.resumenSegmento).toMatchObject({ guiasVenta: -1, montoGuiasVenta: -1190 });
    expect(ajuste.resumenPeriodo).toMatchObject({ guiasVenta: 1, montoGuiasVenta: 1190 });
  });
});
