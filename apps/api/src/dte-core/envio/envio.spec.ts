import { construirDte } from '../documento/construir-dte.js';
import { ErrorValidacionDte } from '../documento/errores.js';
import type { TipoDte } from '../documento/tipos.js';
import { verificarFirmaXml } from '../firma/firma.js';
import { cafDePrueba, documentoDePrueba } from '../testing/documentos-prueba.js';
import { generarCertificadoPrueba } from '../testing/testing.js';
import { desdeIso88591 } from '../xml/xml.util.js';
import { validarXsd, type EsquemaSii } from '../xsd/xsd.js';
import { construirEnvioBoleta, construirEnvioDte, type CaratulaEnvio } from './envio.js';

const certificado = generarCertificadoPrueba({ rut: '12345678-5' });
const fechaFirma = new Date('2026-02-01T13:00:00Z');
const caratula: CaratulaEnvio = {
  rutEmisor: '76086428', dvEmisor: '5', rutEnvia: '12345678', dvEnvia: '5',
  fechaResolucion: new Date('2025-01-15T12:00:00Z'), numeroResolucion: 80, fechaFirma,
};
const cafs = new Map<TipoDte, ReturnType<typeof cafDePrueba>>();

function dte(tipo: TipoDte, folio: number): string {
  let caf = cafs.get(tipo);
  if (!caf) {
    caf = cafDePrueba(tipo, 1, 2000);
    cafs.set(tipo, caf);
  }
  const doc = documentoDePrueba(tipo, folio);
  if (tipo === 61) {
    doc.referencias = [{ tipoDocRef: '33', folioRef: 1, fechaRef: '2026-01-20', codRef: 1, razonRef: 'Anula' }];
  }
  return construirDte(doc, { caf, certificado, fechaFirma }).xmlFirmado;
}

function esperarValido(xml: Buffer, esquema: EsquemaSii): void {
  const r = validarXsd(xml, esquema);
  expect(r.valido, `Errores XSD (${esquema}):\n${r.errores.join('\n')}`).toBe(true);
  const f = verificarFirmaXml(desdeIso88591(xml));
  expect(f.valida, f.errores.join('\n')).toBe(true);
}

describe('construirEnvioDte', () => {
  it('sobre con varios tipos: SubTotDTE agrupado, XSD y firmas (sobre + cada DTE) válidos', () => {
    const dtes = [dte(33, 1), dte(33, 2), dte(34, 1), dte(61, 1)];
    const env = construirEnvioDte({ dtesFirmados: dtes, caratula, certificado });
    esperarValido(env.xmlIso, 'EnvioDTE');
    expect(env.xml).toContain('<SubTotDTE><TpoDTE>33</TpoDTE><NroDTE>2</NroDTE></SubTotDTE>');
    expect(env.xml).toContain('<SubTotDTE><TpoDTE>34</TpoDTE><NroDTE>1</NroDTE></SubTotDTE>');
    expect(env.xml).toContain('<SubTotDTE><TpoDTE>61</TpoDTE><NroDTE>1</NroDTE></SubTotDTE>');
    expect(env.xml).toContain('<RutReceptor>60803000-K</RutReceptor>');
    expect(env.xml).toContain('<FchResol>2025-01-15</FchResol>');
    expect(env.xml).toContain('<SetDTE ID="SetDoc">');
    expect(env.xml).toContain('xsi:schemaLocation="http://www.sii.cl/SiiDte EnvioDTE_v10.xsd"');
    // Cada DTE se inserta textualmente.
    for (const d of dtes) expect(env.xml).toContain(d);
    // 3 firmas: 4 DTE + 1 sobre = 5
    expect(env.xml.match(/<Signature /g)).toHaveLength(5);
  });

  it('acepta DTE con declaración XML y rutReceptor del cliente (intercambio)', () => {
    const conDecl = '<?xml version="1.0" encoding="ISO-8859-1"?>\n' + dte(33, 3);
    const env = construirEnvioDte({
      dtesFirmados: [conDecl],
      caratula: { ...caratula, rutReceptor: '12345678-5' },
      certificado,
    });
    expect(env.xml).toContain('<RutReceptor>12345678-5</RutReceptor>');
    expect(env.xml.match(/<\?xml/g)).toBeNull();
    esperarValido(env.xmlIso, 'EnvioDTE');
  });

  it('rechaza sobres vacíos, boletas y XML que no es un DTE', () => {
    expect(() => construirEnvioDte({ dtesFirmados: [], caratula, certificado })).toThrow(ErrorValidacionDte);
    expect(() => construirEnvioDte({ dtesFirmados: [dte(39, 1)], caratula, certificado })).toThrow(/solo admite/);
    expect(() => construirEnvioDte({ dtesFirmados: ['<x/>'], caratula, certificado })).toThrow(/no es un <DTE>/);
  });
});

describe('construirEnvioBoleta', () => {
  it('sobre con 2 boletas (una 39 y una 41)', () => {
    const env = construirEnvioBoleta({ dtesFirmados: [dte(39, 1), dte(41, 1)], caratula, certificado });
    esperarValido(env.xmlIso, 'EnvioBOLETA');
    expect(env.xml.startsWith('<EnvioBOLETA ')).toBe(true);
    expect(env.xml).toContain('xsi:schemaLocation="http://www.sii.cl/SiiDte EnvioBOLETA_v11.xsd"');
    expect(env.xml).toContain('<SubTotDTE><TpoDTE>39</TpoDTE><NroDTE>1</NroDTE></SubTotDTE>');
    expect(env.xml).toContain('<SubTotDTE><TpoDTE>41</TpoDTE><NroDTE>1</NroDTE></SubTotDTE>');
  });

  it('rechaza tipos que no son boleta', () => {
    expect(() => construirEnvioBoleta({ dtesFirmados: [dte(33, 9)], caratula, certificado })).toThrow(/39\/41/);
  });

  it('acepta 500 boletas y rechaza 501', () => {
    const una = dte(39, 1);
    const env = construirEnvioBoleta({ dtesFirmados: Array.from({ length: 500 }, () => una), caratula, certificado });
    expect(env.xml).toContain('<NroDTE>500</NroDTE>');
    expect(() =>
      construirEnvioBoleta({ dtesFirmados: Array.from({ length: 501 }, () => una), caratula, certificado }),
    ).toThrow(/máximo 500/);
  });
});
