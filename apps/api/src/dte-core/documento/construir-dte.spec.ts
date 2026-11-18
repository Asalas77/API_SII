import { parsearCaf, type Caf } from '../caf/caf.js';
import { construirEnvioBoleta, construirEnvioDte } from '../envio/envio.js';
import { verificarFirmaXml } from '../firma/firma.js';
import { verificarTed } from '../ted/ted.js';
import { cafDePrueba, documentoDePrueba } from '../testing/documentos-prueba.js';
import { generarCafPrueba, generarCertificadoPrueba } from '../testing/testing.js';
import { desdeIso88591 } from '../xml/xml.util.js';
import { validarXsd, type EsquemaSii } from '../xsd/xsd.js';
import { construirDte, type DteConstruido } from './construir-dte.js';
import { ErrorValidacionDte } from './errores.js';
import type { DocumentoDte, TipoDte } from './tipos.js';

const certificado = generarCertificadoPrueba({ rut: '12345678-5' });
const fechaFirma = new Date('2026-02-01T13:00:00Z');
const cafs = new Map<TipoDte, Caf>();
function caf(tipo: TipoDte): Caf {
  let c = cafs.get(tipo);
  if (!c) {
    c = cafDePrueba(tipo);
    cafs.set(tipo, c);
  }
  return c;
}

function construir(doc: DocumentoDte): DteConstruido {
  return construirDte(doc, { caf: caf(doc.idDoc.tipoDte), certificado, fechaFirma });
}

function esperarValido(xml: string | Buffer, esquema: EsquemaSii): void {
  const r = validarXsd(xml, esquema);
  expect(r.valido, `Errores XSD (${esquema}):\n${r.errores.join('\n')}`).toBe(true);
}

/** Valida XSD (DTE), firma y TED de un documento no boleta. */
function verificarCompleto(dte: DteConstruido, tipo: TipoDte): void {
  esperarValido(dte.xmlIso, 'DTE');
  const firma = verificarFirmaXml(desdeIso88591(dte.xmlIso));
  expect(firma.valida, firma.errores.join('\n')).toBe(true);
  expect(verificarTed(dte.ted, caf(tipo).clavePublicaPem)).toBe(true);
}

/** Valida una boleta dentro de un sobre EnvioBOLETA. */
function verificarBoleta(dtes: DteConstruido[], tipo: TipoDte): void {
  const sobre = construirEnvioBoleta({
    dtesFirmados: dtes.map((d) => d.xmlFirmado),
    caratula: {
      rutEmisor: '76086428', dvEmisor: '5', rutEnvia: '12345678', dvEnvia: '5',
      fechaResolucion: '2025-01-15', numeroResolucion: 0, fechaFirma,
    },
    certificado,
  });
  esperarValido(sobre.xmlIso, 'EnvioBOLETA');
  const firma = verificarFirmaXml(desdeIso88591(sobre.xmlIso));
  expect(firma.valida, firma.errores.join('\n')).toBe(true);
  for (const d of dtes) expect(verificarTed(d.ted, caf(tipo).clavePublicaPem)).toBe(true);
}

describe('construirDte: facturas, notas y guías', () => {
  it('factura 33 con dos ítems afectos, uno exento y descuento global', () => {
    const doc = documentoDePrueba(33, 5);
    doc.idDoc.formaPago = 2;
    doc.idDoc.fechaVencimiento = '2026-03-01';
    doc.detalle = [
      { nombre: 'Licencia software', codigoItem: 'LIC-01', cantidad: 2, unidad: 'UN', precioUnitario: 10_000 },
      { nombre: 'Soporte mensual', descripcion: 'Soporte 8x5', cantidad: 1.5, precioUnitario: 3333, descuentoPorcentaje: 10 },
      { nombre: 'Capacitación exenta', cantidad: 1, precioUnitario: 5000, exento: true },
    ];
    doc.descuentosRecargos = [{ tipo: 'D', glosa: 'Descuento por volumen', tipoValor: '%', valor: 5 }];
    const dte = construir(doc);
    // línea2: 4999,5 -> 5000 - 500 = 4500; afecto = 24500; desc 5% = 1225; neto = 23275
    expect(dte.totales).toMatchObject({ mntNeto: 23_275, mntExe: 5000, tasaIva: 19, iva: 4422, mntTotal: 32_697 });
    expect(dte.idDocumento).toBe('F5T33');
    verificarCompleto(dte, 33);
    expect(dte.xmlFirmado).toContain('<DscRcgGlobal><NroLinDR>1</NroLinDR><TpoMov>D</TpoMov>');
    expect(dte.xmlFirmado).toContain('<QtyItem>1.5</QtyItem>');
    expect(dte.xmlFirmado).toContain('<MntTotal>32697</MntTotal>');
  });

  it('el TED usa IT1, RR, RSR y MNT esperados', () => {
    const doc = documentoDePrueba(33);
    doc.receptor.razonSocial = 'X'.repeat(60);
    doc.detalle[0].nombre = 'Y'.repeat(70);
    const dte = construir(doc);
    expect(dte.ted).toContain('<RR>12345678-5</RR>');
    expect(dte.ted).toContain(`<RSR>${'X'.repeat(40)}</RSR>`);
    expect(dte.ted).toContain(`<IT1>${'Y'.repeat(40)}</IT1>`);
    expect(dte.ted).toContain('<MNT>1190</MNT>');
    expect(dte.xmlFirmado).toContain(`<NmbItem>${'Y'.repeat(70)}</NmbItem>`);
  });

  it('NmbItem se trunca a 80 caracteres', () => {
    const doc = documentoDePrueba(33);
    doc.detalle[0].nombre = 'N'.repeat(120);
    const dte = construir(doc);
    expect(dte.xmlFirmado).toContain(`<NmbItem>${'N'.repeat(80)}</NmbItem>`);
    verificarCompleto(dte, 33);
  });

  it('factura exenta 34', () => {
    const dte = construir(documentoDePrueba(34, 2));
    expect(dte.totales).toMatchObject({ mntExe: 1000, mntTotal: 1000, iva: 0 });
    expect(dte.xmlFirmado).not.toContain('<IVA>');
    expect(dte.xmlFirmado).not.toContain('<TasaIVA>');
    expect(dte.xmlFirmado).toContain('<IndExe>1</IndExe>');
    verificarCompleto(dte, 34);
  });

  it('34 con descuento global (IndExeDR)', () => {
    const doc = documentoDePrueba(34);
    doc.descuentosRecargos = [{ tipo: 'D', tipoValor: '$', valor: 100 }];
    const dte = construir(doc);
    expect(dte.totales.mntTotal).toBe(900);
    verificarCompleto(dte, 34);
  });

  it('nota de crédito 61 que anula una factura 33 (CodRef 1)', () => {
    const doc = documentoDePrueba(61, 3);
    doc.referencias = [
      { tipoDocRef: '33', folioRef: 5, fechaRef: '2026-01-20', codRef: 1, razonRef: 'Anula factura' },
    ];
    const dte = construir(doc);
    expect(dte.xmlFirmado).toContain('<Referencia><NroLinRef>1</NroLinRef><TpoDocRef>33</TpoDocRef><FolioRef>5</FolioRef>');
    verificarCompleto(dte, 61);
  });

  it('nota de crédito 61 por corrección de texto con monto cero', () => {
    const doc = documentoDePrueba(61, 4);
    doc.detalle = [{ nombre: 'Corrige giro del receptor', cantidad: 1, precioUnitario: 0 }];
    doc.referencias = [{ tipoDocRef: '33', folioRef: 5, fechaRef: '2026-01-20', codRef: 2, razonRef: 'Corrige giro' }];
    const dte = construir(doc);
    expect(dte.totales.mntTotal).toBe(0);
    verificarCompleto(dte, 61);
  });

  it('nota de débito 56', () => {
    const doc = documentoDePrueba(56);
    doc.referencias = [{ tipoDocRef: '33', folioRef: 5, fechaRef: '2026-01-20', codRef: 3, razonRef: 'Ajuste de monto' }];
    verificarCompleto(construir(doc), 56);
  });

  it('guía de despacho 52 mínima', () => {
    const doc = documentoDePrueba(52);
    doc.idDoc.indTraslado = 1;
    verificarCompleto(construir(doc), 52);
  });

  it('set de pruebas: Referencia con TpoDocRef SET y RazonRef CASO 1', () => {
    const doc = documentoDePrueba(33);
    doc.referencias = [{ tipoDocRef: 'SET', folioRef: 1, fechaRef: '2026-02-01', razonRef: 'CASO 1' }];
    const dte = construir(doc);
    expect(dte.xmlFirmado).toContain('<TpoDocRef>SET</TpoDocRef>');
    expect(dte.xmlFirmado).toContain('<RazonRef>CASO 1</RazonRef>');
    verificarCompleto(dte, 33);
  });

  it('caracteres con tilde y ñ sobreviven a ISO-8859-1 y la firma sigue válida', () => {
    const doc = documentoDePrueba(33);
    doc.emisor.razonSocial = 'Ñandú & Compañía S.p.A.';
    doc.receptor.razonSocial = 'Peñalolén Constitución Ltda.';
    doc.detalle[0].nombre = 'Reparación de cañería';
    doc.detalle[0].descripcion = 'Señal <óptima> “doble”';
    const dte = construir(doc);
    verificarCompleto(dte, 33);
    // 'ñ' = 0xF1 en Latin-1 (un solo byte)
    expect(dte.xmlIso.includes(Buffer.from([0xf1]))).toBe(true);
    const texto = desdeIso88591(dte.xmlIso);
    expect(texto).toContain('Ñandú &amp; Compañía S.p.A.');
    expect(texto).toContain('Reparación de cañería');
    expect(texto).toContain('Señal &lt;óptima&gt; "doble"');
  });

  it('un DTE firmado dentro de un sobre EnvioDTE sigue verificando', () => {
    const a = construir(documentoDePrueba(33, 1));
    const b = construir(documentoDePrueba(33, 2));
    const sobre = construirEnvioDte({
      dtesFirmados: [a.xmlIso.toString('latin1'), b.xmlFirmado],
      caratula: {
        rutEmisor: '76086428', dvEmisor: '5', rutEnvia: '12345678', dvEnvia: '5',
        fechaResolucion: '2025-01-15', numeroResolucion: 80, fechaFirma,
      },
      certificado,
    });
    esperarValido(sobre.xmlIso, 'EnvioDTE');
    const firma = verificarFirmaXml(desdeIso88591(sobre.xmlIso));
    expect(firma.valida, firma.errores.join('\n')).toBe(true);
  });
});

describe('construirDte: boletas', () => {
  it('boleta 39 con IVA incluido y receptor genérico', () => {
    const doc = documentoDePrueba(39, 7);
    doc.idDoc.medioPago = 1;
    doc.detalle = [
      { nombre: 'Café', cantidad: 2, precioUnitario: 1500 },
      { nombre: 'Sándwich', cantidad: 1, precioUnitario: 3200 },
    ];
    const dte = construir(doc);
    // total 6200 -> neto 5210,08 -> 5210; IVA 990
    expect(dte.totales).toMatchObject({ mntTotal: 6200, mntNeto: 5210, iva: 990 });
    expect(dte.xmlFirmado).toContain('<RznSocEmisor>');
    expect(dte.xmlFirmado).toContain('<GiroEmisor>');
    expect(dte.xmlFirmado).not.toContain('<Acteco>');
    expect(dte.xmlFirmado).not.toContain('<TasaIVA>');
    expect(dte.xmlFirmado).toContain('<IndServicio>3</IndServicio>');
    expect(dte.xmlFirmado).toContain('<RUTRecep>66666666-6</RUTRecep>');
    verificarBoleta([dte], 39);
  });

  it('boleta 39 con ítem exento y descuento', () => {
    const doc = documentoDePrueba(39, 8);
    doc.detalle = [
      { nombre: 'Producto', cantidad: 1, precioUnitario: 1190, descuentoMonto: 190 },
      { nombre: 'Exento', cantidad: 1, precioUnitario: 500, exento: true },
    ];
    const dte = construir(doc);
    expect(dte.totales).toMatchObject({ mntNeto: 840, iva: 160, mntExe: 500, mntTotal: 1500 });
    verificarBoleta([dte], 39);
  });

  it('boleta 41 exenta', () => {
    const dte = construir(documentoDePrueba(41, 9));
    expect(dte.xmlFirmado).not.toContain('<MntNeto>');
    expect(dte.xmlFirmado).not.toContain('<IVA>');
    expect(dte.xmlFirmado).toContain('<MntExe>1000</MntExe>');
    verificarBoleta([dte], 41);
  });

  it('boleta con referencia SET (sin FchRef)', () => {
    const doc = documentoDePrueba(39, 10);
    doc.referencias = [{ tipoDocRef: 'SET', folioRef: 1, fechaRef: '2026-02-01', razonRef: 'CASO-1' }];
    const dte = construir(doc);
    expect(dte.xmlFirmado).not.toContain('<FchRef>');
    verificarBoleta([dte], 39);
  });
});

describe('construirDte: errores de negocio', () => {
  it('folio fuera del rango del CAF', () => {
    const doc = documentoDePrueba(33, 101);
    expect(() => construir(doc)).toThrow(/fuera del rango del CAF/);
    expect(() => construir(documentoDePrueba(33, 0))).toThrow(ErrorValidacionDte);
  });

  it('tipo de CAF distinto del documento', () => {
    expect(() => construirDte(documentoDePrueba(33), { caf: caf(34), certificado, fechaFirma })).toThrow(/CAF es de documentos tipo 34/);
  });

  it('CAF de otro emisor', () => {
    const otro = parsearCaf(generarCafPrueba({ tipoDte: 33, folioDesde: 1, folioHasta: 10, rutEmisor: '96511460-2' }));
    expect(() => construirDte(documentoDePrueba(33), { caf: otro, certificado, fechaFirma })).toThrow(/CAF pertenece/);
  });

  it('boleta con Acteco indebido', () => {
    const doc = documentoDePrueba(39);
    doc.emisor.actecos = [620200];
    expect(() => construir(doc)).toThrow(/no admiten Acteco/);
  });

  it('factura sin Acteco', () => {
    const doc = documentoDePrueba(33);
    doc.emisor.actecos = [];
    expect(() => construir(doc)).toThrow(/Acteco/);
  });

  it('nota de crédito 61 sin referencia (o solo con SET)', () => {
    expect(() => construir(documentoDePrueba(61))).toThrow(/debe referenciar/);
    const doc = documentoDePrueba(61);
    doc.referencias = [{ tipoDocRef: 'SET', folioRef: 1, fechaRef: '2026-02-01', razonRef: 'CASO 1' }];
    expect(() => construir(doc)).toThrow(/debe referenciar/);
  });

  it('nota sin codRef', () => {
    const doc = documentoDePrueba(61);
    doc.referencias = [{ tipoDocRef: '33', folioRef: 1, fechaRef: '2026-02-01' }];
    expect(() => construir(doc)).toThrow(/codRef/);
  });

  it('más de 60 líneas en facturas; hasta 1000 en boletas', () => {
    const linea = { nombre: 'Item', cantidad: 1, precioUnitario: 10 };
    const f = documentoDePrueba(33);
    f.detalle = Array.from({ length: 61 }, () => linea);
    expect(() => construir(f)).toThrow(/máximo 60 líneas/);
    const b = documentoDePrueba(39);
    b.detalle = Array.from({ length: 1001 }, () => linea);
    expect(() => construir(b)).toThrow(/máximo 1000 líneas/);
  });

  it('60 líneas en factura validan contra el XSD', () => {
    const f = documentoDePrueba(33);
    f.detalle = Array.from({ length: 60 }, (_, i) => ({ nombre: `Item ${i + 1}`, cantidad: 1, precioUnitario: 10 }));
    verificarCompleto(construir(f), 33);
  });

  it('RUT con dígito verificador incorrecto', () => {
    const doc = documentoDePrueba(33);
    doc.receptor.dv = '0';
    expect(() => construir(doc)).toThrow(/dígito verificador/);
  });

  it('RUT genérico en factura, factura sin ítems afectos, fecha inválida', () => {
    const g = documentoDePrueba(33);
    g.receptor.rut = '66666666';
    g.receptor.dv = '6';
    expect(() => construir(g)).toThrow(/genérico/);
    const e = documentoDePrueba(33);
    e.detalle[0].exento = true;
    expect(() => construir(e)).toThrow(/requiere al menos un ítem afecto/);
    const f = documentoDePrueba(33);
    f.idDoc.fechaEmision = '01-02-2026';
    expect(() => construir(f)).toThrow(/fecha inválida/);
  });
});
