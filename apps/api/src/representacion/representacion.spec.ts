import { generateKeyPairSync, randomBytes } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { construirDte } from '../dte-core/documento/construir-dte.js';
import type { DocumentoDte, TipoDte } from '../dte-core/documento/tipos.js';
import { construirEnvioDte } from '../dte-core/envio/envio.js';
import { parsearCaf, type Caf } from '../dte-core/caf/caf.js';
import { documentoDePrueba, RUT_EMISOR_PRUEBA } from '../dte-core/testing/documentos-prueba.js';
import { generarCertificadoPrueba } from '../dte-core/testing/testing.js';
import { extraerDatosImpresion } from './datos-impresion.js';
import { admiteCedible, formatearMonto, generarPdf } from './generar-pdf.js';
import { bytesTed, dimensionesPng, generarPdf417 } from './timbre-pdf417.js';

const certificado = generarCertificadoPrueba({ rut: '12345678-5' });
const fechaFirma = new Date('2026-02-01T13:00:00Z');
const salida = join(import.meta.dirname, '..', '..', 'test', 'salida-pdf');
const resolucion = { numero: 0, fecha: '2026-01-15' };

/**
 * CAF de prueba con claves RSA de 512 bits y FRMA de 64 bytes, como los CAF reales del SII. El CAF de
 * `dte-core/testing` usa RSA 2048 y produce un TED de ~1.500 bytes, que no cabe en un PDF417 (máx. ~925 codewords).
 */
function cafRealista(tipo: TipoDte): Caf {
  const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 512 });
  const jwk = publicKey.export({ format: 'jwk' });
  const b64 = (u: string | undefined) => Buffer.from(u ?? '', 'base64url').toString('base64');
  const xml =
    `<?xml version="1.0"?>
<AUTORIZACION><CAF version="1.0"><DA><RE>${RUT_EMISOR_PRUEBA}</RE><RS>EMPRESA DE PRUEBA SPA</RS><TD>${tipo}</TD>` +
    `<RNG><D>1</D><H>100</H></RNG><FA>2026-01-15</FA><RSAPK><M>${b64(jwk.n)}</M><E>${b64(jwk.e)}</E></RSAPK><IDK>300</IDK></DA>` +
    `<FRMA algoritmo="SHA1withRSA">${randomBytes(64).toString('base64')}</FRMA></CAF>` +
    `<RSASK>${privateKey.export({ type: 'pkcs1', format: 'pem' }).toString().trim()}
</RSASK>` +
    `<RSAPUBK>${publicKey.export({ type: 'spki', format: 'pem' }).toString().trim()}
</RSAPUBK></AUTORIZACION>`;
  return parsearCaf(xml);
}

const cafs = new Map<TipoDte, Caf>();
function dte(doc: DocumentoDte) {
  const tipo = doc.idDoc.tipoDte;
  if (!cafs.has(tipo)) cafs.set(tipo, cafRealista(tipo));
  return construirDte(doc, { caf: cafs.get(tipo)!, certificado, fechaFirma });
}

function factura(tipo: TipoDte = 33): DocumentoDte {
  const base = documentoDePrueba(tipo, 7);
  return {
    ...base,
    emisor: {
      ...base.emisor,
      razonSocial: 'COMERCIAL ÑUÑOA Y COMPAÑÍA LTDA',
      giro: 'Venta de artículos de ferretería y construcción',
      telefono: '+56 2 2345 6789',
      correo: 'ventas@ejemplo.cl',
    },
    receptor: {
      ...base.receptor,
      razonSocial: 'Ñandú Pérez Muñoz Jardines EIRL',
      giro: 'Administración de salas cuna',
      direccion: 'Gran Avenida José Miguel Carrera 5555 Of 300',
      comuna: 'San Miguel',
      ciudad: 'Santiago',
    },
    idDoc: { ...base.idDoc, fechaVencimiento: '2026-03-01', formaPago: 2 },
    detalle: [
      {
        nombre: 'Tornillo galvanizado 1/4 x 2 pulgadas (caja 100 unidades) con descripción larga para probar el salto de línea',
        cantidad: 551,
        unidad: 'UN',
        precioUnitario: 7659,
        descuentoMonto: 1500,
        codigoItem: 'ITM1',
      },
      { nombre: 'Asesoría técnica en terreno', descripcion: 'Visita de obra incluida', cantidad: 2.5, unidad: 'HR', precioUnitario: 6860, exento: true, codigoItem: 'ITM2' },
    ],
    descuentosRecargos: [{ tipo: 'D', glosa: 'Descuento por volumen', tipoValor: '%', valor: 10 }],
    referencias: [{ tipoDocRef: '801', folioRef: 4500, fechaRef: '2026-01-20', razonRef: 'Orden de compra del cliente' }],
  };
}

function guarda(nombre: string, pdf: Buffer): void {
  mkdirSync(salida, { recursive: true });
  writeFileSync(join(salida, nombre), pdf);
}

describe('timbre PDF417', () => {
  it('genera un PNG válido desde el TED textual', async () => {
    const { ted } = dte(factura());
    const png = await generarPdf417(ted);
    expect(png.subarray(0, 8).toString('hex')).toBe('89504e470d0a1a0a');
    const { ancho, alto } = dimensionesPng(png);
    expect(ancho).toBeGreaterThan(alto);
    // tamaño impreso <= 9 x 4 cm (X dim 0,6 pt, 4 px por módulo)
    expect((ancho / 4) * 0.6).toBeLessThanOrEqual(9 * 28.3465);
    expect((alto / 4) * 0.6).toBeLessThanOrEqual(4 * 28.3465);
  });

  it('los bytes del TED son ISO-8859-1 y rechaza caracteres fuera de Latin-1', () => {
    expect(bytesTed('<TED>Ñ</TED>')[5]).toBe(0xd1);
    expect(() => bytesTed('<TED>€</TED>')).toThrow();
  });
});

describe('extraerDatosImpresion', () => {
  it('extrae los datos de una factura (con tildes) desde string y desde Buffer ISO-8859-1', () => {
    const r = dte(factura());
    for (const entrada of [r.xmlFirmado, r.xmlIso]) {
      const d = extraerDatosImpresion(entrada);
      expect(d.tipo).toBe(33);
      expect(d.nombreDocumento).toBe('FACTURA ELECTRÓNICA');
      expect(d.folio).toBe(7);
      expect(d.fechaEmision).toBe('2026-02-01');
      expect(d.emisor.rut).toBe('76.086.428-5');
      expect(d.emisor.razonSocial).toBe('COMERCIAL ÑUÑOA Y COMPAÑÍA LTDA');
      expect(d.emisor.actecos).toEqual([620200]);
      expect(d.receptor.razonSocial).toBe('Ñandú Pérez Muñoz Jardines EIRL');
      expect(d.receptor.rut).toBe('12.345.678-5');
      expect(d.detalle).toHaveLength(2);
      expect(d.detalle[0]).toMatchObject({ codigo: 'ITM1', cantidad: 551, descuentoMonto: 1500, exento: false });
      expect(d.detalle[1]).toMatchObject({ cantidad: 2.5, exento: true, monto: 17150 });
      expect(d.descuentosRecargos[0]).toMatchObject({ tipo: 'D', tipoValor: '%', valor: 10, exento: false });
      expect(d.referencias[0]).toMatchObject({ tipoDocumento: '801', nombreTipoDocumento: 'Orden de Compra', folio: '4500' });
      expect(d.totales.total).toBe(r.totales.mntTotal);
      expect(d.totales.iva).toBe(r.totales.iva);
      expect(d.tedXml).toBe(r.ted);
    }
  });

  it('lee un DTE dentro de un sobre EnvioDTE', () => {
    const r = dte(factura());
    const sobre = construirEnvioDte({
      dtesFirmados: [r.xmlFirmado],
      caratula: { rutEmisor: '76086428', dvEmisor: '5', rutEnvia: '12345678', dvEnvia: '5', fechaResolucion: '2026-01-15', numeroResolucion: 0, fechaFirma },
      certificado,
    });
    const d = extraerDatosImpresion(sobre.xmlIso);
    expect(d.folio).toBe(7);
    expect(d.receptor.razonSocial).toBe('Ñandú Pérez Muñoz Jardines EIRL');
    expect(d.tedXml).toBe(r.ted);
  });
});

describe('generarPdf', () => {
  const esPdf = (b: Buffer): void => {
    expect(b.subarray(0, 5).toString('latin1')).toBe('%PDF-');
    expect(b.length).toBeGreaterThan(5000);
  };

  it('factura 33 carta', async () => {
    const pdf = await generarPdf(dte(factura()).xmlIso, { unidadSii: 'SANTIAGO CENTRO', resolucion });
    esPdf(pdf);
    guarda('factura-33.pdf', pdf);
  });

  it('factura 33 cedible', async () => {
    const pdf = await generarPdf(dte(factura()).xmlIso, { unidadSii: 'SANTIAGO CENTRO', resolucion, cedible: true });
    esPdf(pdf);
    guarda('factura-33-cedible.pdf', pdf);
  });

  it('factura exenta 34', async () => {
    const pdf = await generarPdf(dte(documentoDePrueba(34, 3)).xmlFirmado, { unidadSii: 'SANTIAGO CENTRO', resolucion, cedible: true });
    esPdf(pdf);
    guarda('factura-exenta-34-cedible.pdf', pdf);
  });

  it('nota de crédito 61 (sin cedible aunque se pida)', async () => {
    const base = factura(61);
    const doc: DocumentoDte = {
      ...base,
      detalle: [{ nombre: 'Donde dice: Ñandú SA, debe decir: Ñandú SpA', cantidad: 1, precioUnitario: 1000 }],
      descuentosRecargos: [],
      referencias: [{ tipoDocRef: '33', folioRef: 7, fechaRef: '2026-02-01', codRef: 2, razonRef: 'Corrige giro del receptor' }],
    };
    const pdf = await generarPdf(dte(doc).xmlIso, { unidadSii: 'SANTIAGO CENTRO', resolucion, cedible: true });
    esPdf(pdf);
    expect(admiteCedible(61)).toBe(false);
    guarda('nota-credito-61.pdf', pdf);
  });

  it('guía de despacho 52 cedible', async () => {
    const base = factura(52);
    const doc: DocumentoDte = { ...base, idDoc: { ...base.idDoc, indTraslado: 1, formaPago: undefined }, referencias: [] };
    const pdf = await generarPdf(dte(doc).xmlIso, { unidadSii: 'SANTIAGO CENTRO', resolucion, cedible: true });
    esPdf(pdf);
    expect(admiteCedible(52, 5)).toBe(false);
    guarda('guia-despacho-52-cedible.pdf', pdf);
  });

  it('boleta 39 térmica 80 mm', async () => {
    const base = documentoDePrueba(39, 15);
    const doc: DocumentoDte = {
      ...base,
      detalle: [
        { nombre: 'Café americano grande', cantidad: 2, precioUnitario: 2500 },
        { nombre: 'Empanada de pino', cantidad: 3, precioUnitario: 1990, descuentoMonto: 500 },
      ],
    };
    const pdf = await generarPdf(dte(doc).xmlIso, { unidadSii: 'SANTIAGO CENTRO', resolucion, urlVerificacion: 'https://boletas.ejemplo.cl' });
    esPdf(pdf);
    guarda('boleta-39-termica.pdf', pdf);
  });

  it('formatea miles con punto también en 4 cifras', () => {
    expect(formatearMonto(1234)).toBe('1.234');
    expect(formatearMonto(1234567)).toBe('1.234.567');
    expect(formatearMonto(-999)).toBe('-999');
  });
});
