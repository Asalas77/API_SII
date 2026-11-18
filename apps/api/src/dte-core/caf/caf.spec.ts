import { generarCafPrueba } from '../testing/testing.js';
import { cafVigente, claveCafCoincide, folioEnRango, parsearCaf, sumarMeses } from './caf.js';

const xml = generarCafPrueba({
  tipoDte: 33,
  folioDesde: 1,
  folioHasta: 100,
  rutEmisor: '76086428-5',
  razonSocial: 'ACME & CIA',
  fechaAutorizacion: '2026-01-15',
});

describe('parsearCaf', () => {
  it('extrae los campos del CAF', () => {
    const caf = parsearCaf(xml);
    expect(caf).toMatchObject({
      rutEmisor: '76086428-5',
      razonSocial: 'ACME & CIA',
      tipoDte: 33,
      folioDesde: 1,
      folioHasta: 100,
      fechaAutorizacion: '2026-01-15',
      idk: 300,
    });
    expect(caf.clavePrivadaPem).toMatch(/^-----BEGIN RSA PRIVATE KEY-----\n/);
    expect(caf.clavePublicaPem).toMatch(/^-----BEGIN PUBLIC KEY-----\n/);
    expect(caf.fechaVencimiento.toISOString().slice(0, 10)).toBe('2026-07-15');
  });

  it('xmlCaf es el elemento CAF textual del archivo', () => {
    const caf = parsearCaf(xml);
    expect(caf.xmlCaf.startsWith('<CAF version="1.0"><DA>')).toBe(true);
    expect(caf.xmlCaf.endsWith('</CAF>')).toBe(true);
    expect(xml).toContain(caf.xmlCaf);
  });

  it('vigencia parametrizable y cálculo de fin de mes', () => {
    expect(parsearCaf(xml, { mesesVigencia: 12 }).fechaVencimiento.toISOString().slice(0, 10)).toBe('2027-01-15');
    expect(sumarMeses('2026-08-31', 6).toISOString().slice(0, 10)).toBe('2027-02-28');
  });

  it('cafVigente respeta la fecha de vencimiento', () => {
    const caf = parsearCaf(xml);
    expect(cafVigente(caf, new Date('2026-07-15T23:00:00Z'))).toBe(true);
    expect(cafVigente(caf, new Date('2026-07-16T12:00:00Z'))).toBe(false);
  });

  it('falla con XML sin campos obligatorios', () => {
    expect(() => parsearCaf('<AUTORIZACION></AUTORIZACION>')).toThrow(/CAF inválido/);
    expect(() => parsearCaf(xml.replace(/<RSASK>[\s\S]*<\/RSASK>/, ''))).toThrow(/RSASK/);
  });
});

describe('folioEnRango / claveCafCoincide', () => {
  it('valida los límites del rango', () => {
    const caf = parsearCaf(xml);
    expect(folioEnRango(caf, 1)).toBe(true);
    expect(folioEnRango(caf, 100)).toBe(true);
    expect(folioEnRango(caf, 0)).toBe(false);
    expect(folioEnRango(caf, 101)).toBe(false);
    expect(folioEnRango(caf, 1.5)).toBe(false);
  });

  it('detecta si la clave privada corresponde a la pública', () => {
    const a = parsearCaf(xml);
    const b = parsearCaf(generarCafPrueba({ tipoDte: 33, folioDesde: 1, folioHasta: 5, rutEmisor: '76086428-5' }));
    expect(claveCafCoincide(a)).toBe(true);
    expect(claveCafCoincide({ clavePrivadaPem: a.clavePrivadaPem, clavePublicaPem: b.clavePublicaPem })).toBe(false);
    expect(claveCafCoincide({ clavePrivadaPem: 'x', clavePublicaPem: 'y' })).toBe(false);
  });
});
