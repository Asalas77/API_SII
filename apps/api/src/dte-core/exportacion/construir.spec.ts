import type { Caf } from '../caf/caf.js';
import { construirDte } from '../documento/construir-dte.js';
import { ErrorValidacionDte } from '../documento/errores.js';
import type { DocumentoDte, TipoDte } from '../documento/tipos.js';
import { construirEnvioDte } from '../envio/envio.js';
import { verificarFirmaXml } from '../firma/firma.js';
import { verificarTed } from '../ted/ted.js';
import { cafDePrueba, documentoDePrueba, documentoExportacionDePrueba } from '../testing/documentos-prueba.js';
import { generarCertificadoPrueba } from '../testing/testing.js';
import { desdeIso88591 } from '../xml/xml.util.js';
import { validarXsd } from '../xsd/xsd.js';
import { MONEDAS_ADUANA, MONEDAS_XSD, codigoAduanaDeMoneda } from './tablas/index.js';
import { calcularTotalesExportacion } from './totales.js';

const certificado = generarCertificadoPrueba({ rut: '12345678-5' });
const fechaFirma = new Date('2026-02-01T13:00:00Z');
const cafs = new Map<TipoDte, Caf>();
function caf(tipo: TipoDte): Caf {
  let c = cafs.get(tipo);
  if (!c) cafs.set(tipo, (c = cafDePrueba(tipo)));
  return c;
}
const construir = (doc: DocumentoDte) => construirDte(doc, { caf: caf(doc.idDoc.tipoDte), certificado, fechaFirma });

function clonar(tipo: 110 | 111 | 112 = 110): DocumentoDte {
  return structuredClone(documentoExportacionDePrueba(tipo));
}

function fallo(doc: DocumentoDte): { mensaje: string; campo?: string } {
  try {
    construir(doc);
  } catch (e) {
    if (e instanceof ErrorValidacionDte) return { mensaje: e.message, campo: e.campo };
    throw e;
  }
  throw new Error('se esperaba ErrorValidacionDte');
}

describe('exportación 110/111/112: XML válido', () => {
  for (const tipo of [110, 111, 112] as const) {
    it(`tipo ${tipo}: valida contra el XSD, firma y TED`, () => {
      const dte = construir(documentoExportacionDePrueba(tipo));
      const r = validarXsd(dte.xmlIso, 'DTE');
      expect(r.valido, r.errores.join('\n')).toBe(true);
      expect(verificarFirmaXml(desdeIso88591(dte.xmlIso)).valida).toBe(true);
      expect(verificarTed(dte.ted, caf(tipo).clavePublicaPem)).toBe(true);
      expect(dte.xmlFirmado).toContain(`<Exportaciones ID="F1T${tipo}">`);
      expect(dte.xmlFirmado).not.toContain('<Documento ');
      expect(dte.idDocumento).toBe(`F1T${tipo}`);
    });
  }

  it('totales con decimales, equivalente en pesos entero y TED en pesos', () => {
    const dte = construir(documentoExportacionDePrueba());
    const t = dte.totalesExportacion!;
    expect(t.montosLineas).toEqual([4550, 2642.8317]);
    expect(t.montoTotal).toBe(7192.8317);
    expect(t.montoExento).toBe(7192.8317);
    expect(t.montoTotalPesos).toBe(6656654);
    expect(dte.totales.mntTotal).toBe(6656654);
    expect(dte.totales.mntExe).toBe(6656654);
    expect(dte.xmlFirmado).toContain('<TpoMoneda>DOLAR USA</TpoMoneda><MntExe>7192.8317</MntExe><MntTotal>7192.8317</MntTotal>');
    expect(dte.xmlFirmado).toContain(
      '<OtraMoneda><TpoMoneda>PESO CL</TpoMoneda><TpoCambio>925.4567</TpoCambio><MntExeOtrMnda>6656654</MntExeOtrMnda><MntTotOtrMnda>6656654</MntTotOtrMnda></OtraMoneda>',
    );
    expect(dte.ted).toContain('<MNT>6656654</MNT>');
    expect(dte.ted).toContain('<RR>55555555-5</RR>');
    expect(dte.xmlFirmado).toContain('<RUTRecep>55555555-5</RUTRecep>');
    expect(dte.xmlFirmado).not.toContain('<IVA>');
    expect(dte.xmlFirmado).toContain('<Extranjero><NumId>US-12-3456789</NumId><Nacionalidad>225</Nacionalidad></Extranjero>');
  });

  it('descuentos de línea y globales, y sobre EnvioDTE junto a una factura 33', () => {
    const doc = clonar();
    doc.detalle[0]!.descuentoPorcentaje = 10;
    doc.detalle[1]!.descuentoMonto = 100;
    doc.descuentosRecargos = [{ tipo: 'D', tipoValor: '%', valor: 5, glosa: 'Descuento comercial' }, { tipo: 'R', tipoValor: '$', valor: 12.5 }];
    const dte = construir(doc);
    const t = dte.totalesExportacion!;
    expect(t.montosLineas).toEqual([4095, 2542.8317]);
    // (4095 + 2542.8317) = 6637.8317; -5% = 331.8916 (redondeo a 4 decimales); + 12,50
    expect(t.montosGlobales).toEqual([331.8916, 12.5]);
    expect(t.montoTotal).toBe(6318.4401);
    const r = validarXsd(dte.xmlIso, 'DTE');
    expect(r.valido, r.errores.join('\n')).toBe(true);

    const f33 = construirDte(documentoDePrueba(33, 5), { caf: caf(33), certificado, fechaFirma });
    const sobre = construirEnvioDte({
      dtesFirmados: [f33.xmlFirmado, dte.xmlFirmado, construir(documentoExportacionDePrueba(112)).xmlFirmado],
      caratula: { rutEmisor: '76086428', dvEmisor: '5', rutEnvia: '12345678', dvEnvia: '5', fechaResolucion: '2025-01-15', numeroResolucion: 0, fechaFirma },
      certificado,
    });
    const rs = validarXsd(sobre.xmlIso, 'EnvioDTE');
    expect(rs.valido, rs.errores.join('\n')).toBe(true);
    expect(sobre.xml).toContain('<SubTotDTE><TpoDTE>110</TpoDTE><NroDTE>1</NroDTE></SubTotDTE>');
    expect(sobre.xml).toContain('<SubTotDTE><TpoDTE>112</TpoDTE><NroDTE>1</NroDTE></SubTotDTE>');
    expect(verificarFirmaXml(desdeIso88591(sobre.xmlIso)).valida).toBe(true);
  });

  it('servicio de hotelería (indServicio 4) sin cláusula ni vía ni bultos', () => {
    const doc = clonar();
    doc.idDoc.indServicio = 4;
    doc.exportacion!.aduana = { codigoPaisReceptor: 225 };
    const dte = construir(doc);
    const r = validarXsd(dte.xmlIso, 'DTE');
    expect(r.valido, r.errores.join('\n')).toBe(true);
  });

  it('nota 112 mínima: sin Aduana y con referencia a la 110', () => {
    const doc = clonar(112);
    delete doc.exportacion!.aduana;
    const dte = construir(doc);
    expect(validarXsd(dte.xmlIso, 'DTE').valido).toBe(true);
  });
});

describe('exportación: validaciones de negocio', () => {
  it('rechaza un receptor con RUT distinto de 55555555-5', () => {
    const doc = clonar();
    doc.receptor.rut = '12345678';
    doc.receptor.dv = '5';
    expect(fallo(doc)).toMatchObject({ campo: 'receptor.rut' });
  });

  it('exige nacionalidad con formato y de la tabla de países', () => {
    const doc = clonar();
    (doc.exportacion!.extranjero as { nacionalidad: unknown }).nacionalidad = undefined;
    expect(fallo(doc).campo).toBe('exportacion.extranjero.nacionalidad');
    const otro = clonar();
    otro.exportacion!.extranjero.nacionalidad = 1;
    expect(fallo(otro).mensaje).toContain('Países (51-9)');
  });

  it('moneda: solo glosas del XSD y distinta de peso', () => {
    const doc = clonar();
    doc.exportacion!.moneda = 'DOLAR';
    expect(fallo(doc).campo).toBe('exportacion.moneda');
    doc.exportacion!.moneda = 'PESO CL';
    expect(fallo(doc).mensaje).toContain('distinta del peso');
  });

  it('tipo de cambio fuera de rango o con más de 4 decimales', () => {
    const doc = clonar();
    doc.exportacion!.tipoCambio = 0;
    expect(fallo(doc).campo).toBe('exportacion.tipoCambio');
    doc.exportacion!.tipoCambio = 925.45678;
    expect(fallo(doc).campo).toBe('exportacion.tipoCambio');
  });

  it('la factura exige Aduana, país receptor, cláusula, vía, bultos y puertos (bienes)', () => {
    const sinAduana = clonar();
    delete sinAduana.exportacion!.aduana;
    expect(fallo(sinAduana).campo).toBe('exportacion.aduana');
    for (const campo of ['codigoPaisReceptor', 'codigoModalidadVenta', 'codigoClausulaVenta', 'totalClausulaVenta', 'codigoViaTransporte', 'totalBultos', 'codigoPaisDestino', 'codigoPuertoEmbarque', 'codigoPuertoDesembarque'] as const) {
      const doc = clonar();
      delete doc.exportacion!.aduana![campo];
      delete doc.exportacion!.aduana!.bultos;
      expect(fallo(doc).campo, campo).toBe(`exportacion.aduana.${campo}`);
    }
  });

  it('códigos de Aduana fuera de tabla y bultos que no suman', () => {
    const doc = clonar();
    doc.exportacion!.aduana!.codigoViaTransporte = 2;
    expect(fallo(doc).mensaje).toContain('Vías de Transporte (51-13)');
    const d2 = clonar();
    d2.exportacion!.aduana!.bultos = [{ codigoTipo: 10, cantidad: 100 }];
    expect(fallo(d2).campo).toBe('exportacion.aduana.totalBultos');
    const d3 = clonar();
    expect(() => construirDte(d3, { caf: caf(110), certificado, fechaFirma, validarTablasAduana: false })).not.toThrow();
    d3.exportacion!.aduana!.codigoViaTransporte = 2;
    expect(() => construirDte(d3, { caf: caf(110), certificado, fechaFirma, validarTablasAduana: false })).not.toThrow();
  });

  it('las notas exigen referenciar un documento de exportación con codRef', () => {
    const sinRef = clonar(112);
    sinRef.referencias = [];
    expect(fallo(sinRef).campo).toBe('referencias');
    const aOtro = clonar(111);
    aOtro.referencias = [{ tipoDocRef: '33', folioRef: 1, fechaRef: '2026-02-01', codRef: 1 }];
    expect(fallo(aOtro).campo).toBe('referencias');
    const sinCod = clonar(112);
    delete sinCod.referencias![0]!.codRef;
    expect(fallo(sinCod).mensaje).toContain('codRef');
  });

  it('anticipo exige fecha de cancelación; solo un DUS por factura', () => {
    const doc = clonar();
    doc.exportacion!.formaPagoExportacion = 32;
    expect(fallo(doc).campo).toBe('exportacion.fechaCancelacion');
    const d2 = clonar();
    d2.referencias!.push({ tipoDocRef: '807', folioRef: 'X', fechaRef: '2026-02-01' });
    expect(fallo(d2).campo).toBe('referencias');
  });

  it('rechaza impuestos, traslado y descuento en monto decimal por línea', () => {
    const a = clonar();
    a.impuestosAdicionales = [{ codigo: 15, monto: 1 }];
    expect(fallo(a).campo).toBe('impuestosAdicionales');
    const b = clonar();
    b.detalle[0]!.descuentoMonto = 10.5;
    expect(fallo(b).campo).toBe('detalle[0].descuentoMonto');
    const c = clonar();
    c.idDoc.indServicio = 2;
    expect(fallo(c).campo).toBe('idDoc.indServicio');
  });

  it('más de 4 decimales en el precio o 6 en la cantidad', () => {
    const doc = clonar();
    doc.detalle[0]!.precioUnitario = 1.1234567;
    expect(fallo(doc).campo).toBe('detalle[0].precioUnitario');
  });

  it('pesos: unidad obligatoria y neto no mayor que bruto', () => {
    const a = clonar();
    delete a.exportacion!.aduana!.codigoUnidadPesoBruto;
    expect(fallo(a).campo).toBe('exportacion.aduana.codigoUnidadPesoBruto');
    const b = clonar();
    b.exportacion!.aduana!.pesoNeto = 99999;
    expect(fallo(b).campo).toBe('exportacion.aduana.pesoNeto');
  });

  it('un CAF de otro tipo se rechaza', () => {
    expect(() => construirDte(documentoExportacionDePrueba(110), { caf: caf(112), certificado, fechaFirma })).toThrow(/CAF es de documentos tipo 112/);
  });
});

describe('exportación: totales y tablas', () => {
  it('redondea mitades hacia arriba a 4 decimales y a pesos enteros', () => {
    const doc = clonar();
    doc.detalle = [{ nombre: 'X', cantidad: 3, precioUnitario: 0.33335 }];
    doc.exportacion!.tipoCambio = 1000.5;
    const t = calcularTotalesExportacion(doc);
    expect(t.montosLineas).toEqual([1.0001]);
    expect(t.montoTotalPesos).toBe(1001);
  });

  it('las 40 glosas del XSD y la moneda USD de Aduana (código 13)', () => {
    expect(MONEDAS_XSD.size).toBe(40);
    expect(MONEDAS_XSD.has('DOLAR USA')).toBe(true);
    expect(codigoAduanaDeMoneda('DOLAR USA')).toBe(13);
    expect(MONEDAS_ADUANA.length).toBeGreaterThan(40);
  });
});
