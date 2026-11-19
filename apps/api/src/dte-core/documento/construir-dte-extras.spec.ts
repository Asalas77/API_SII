import { construirEnvioBoleta } from '../envio/envio.js';
import { cafDePrueba, documentoDePrueba, RUT_EMISOR_PRUEBA } from '../testing/documentos-prueba.js';
import { generarCafPrueba, generarCertificadoPrueba } from '../testing/testing.js';
import { parsearCaf } from '../caf/caf.js';
import { validarXsd } from '../xsd/xsd.js';
import { construirDte } from './construir-dte.js';
import { ErrorValidacionDte } from './errores.js';
import type { TipoDte } from './tipos.js';

const certificado = generarCertificadoPrueba({ rut: '12345678-5' });
const fechaFirma = new Date('2026-02-01T13:00:00Z');

describe('construirDte: proveedor de software (RUTProvSW)', () => {
  const caf = cafDePrueba(39);
  const doc = () => ({ ...documentoDePrueba(39), proveedorSoftware: { rut: '76086428', dv: '5', razonSocial: 'Proveedor SpA' } });

  function sobre(xmlDtes: string[]) {
    return construirEnvioBoleta({
      dtesFirmados: xmlDtes,
      caratula: {
        rutEmisor: '76086428', dvEmisor: '5', rutEnvia: '12345678', dvEnvia: '5',
        fechaResolucion: '2025-01-15', numeroResolucion: 0, fechaFirma,
      },
      certificado,
    });
  }

  it('emite RUTProvSW entre Receptor y Totales y valida contra EnvioBOLETA', () => {
    const dte = construirDte(doc(), { caf, certificado, fechaFirma });
    expect(dte.xmlFirmado).toMatch(/<\/Receptor><RUTProvSW>76086428-5<\/RUTProvSW><Totales>/);
    expect(dte.xmlFirmado).not.toContain('Proveedor SpA');
    const r = validarXsd(sobre([dte.xmlFirmado]).xmlIso, 'EnvioBOLETA');
    expect(r.valido, r.errores.join('\n')).toBe(true);
  });

  it('boleta exenta (41) también lo admite', () => {
    const d = { ...documentoDePrueba(41), proveedorSoftware: { rut: '76086428', dv: '5' } };
    const dte = construirDte(d, { caf: cafDePrueba(41), certificado, fechaFirma });
    expect(dte.xmlFirmado).toContain('<RUTProvSW>76086428-5</RUTProvSW>');
    const r = validarXsd(sobre([dte.xmlFirmado]).xmlIso, 'EnvioBOLETA');
    expect(r.valido, r.errores.join('\n')).toBe(true);
  });

  it('sin proveedorSoftware no emite el elemento', () => {
    const dte = construirDte(documentoDePrueba(39), { caf, certificado, fechaFirma });
    expect(dte.xmlFirmado).not.toContain('RUTProvSW');
  });

  it('rechaza un RUT con DV incorrecto', () => {
    const d = { ...doc(), proveedorSoftware: { rut: '76086428', dv: '1' } };
    expect(() => construirDte(d, { caf, certificado, fechaFirma })).toThrow(ErrorValidacionDte);
  });

  it('se ignora en documentos que no son boleta (DTE_v10 no lo define)', () => {
    const d = { ...documentoDePrueba(33), proveedorSoftware: { rut: '76086428', dv: '5' } };
    const dte = construirDte(d, { caf: cafDePrueba(33), certificado, fechaFirma });
    expect(dte.xmlFirmado).not.toContain('RUTProvSW');
    expect(validarXsd(dte.xmlIso, 'DTE').valido).toBe(true);
  });
});

describe('construirDte: vigencia del CAF', () => {
  const cafVencido = (tipo: TipoDte) =>
    parsearCaf(
      generarCafPrueba({ tipoDte: tipo, folioDesde: 1, folioHasta: 10, rutEmisor: RUT_EMISOR_PRUEBA, fechaAutorizacion: '2025-01-15' }),
    );

  it('rechaza un CAF de factura vencido a la fecha de emisión', () => {
    const doc = documentoDePrueba(33); // emisión 2026-02-01; CAF vence 2025-07-15
    const fn = () => construirDte(doc, { caf: cafVencido(33), certificado, fechaFirma });
    expect(fn).toThrow(ErrorValidacionDte);
    expect(fn).toThrow(/CAF del tipo 33 venció el 2025-07-15/);
  });

  it('aplica a notas de crédito y débito', () => {
    for (const tipo of [56, 61] as const) {
      const doc = documentoDePrueba(tipo);
      doc.referencias = [{ tipoDocRef: '33', folioRef: 1, fechaRef: '2025-01-20', codRef: 1 }];
      expect(() => construirDte(doc, { caf: cafVencido(tipo), certificado, fechaFirma })).toThrow(/venció/);
    }
  });

  it('acepta el CAF si la emisión es anterior al vencimiento', () => {
    const doc = documentoDePrueba(33);
    doc.idDoc.fechaEmision = '2025-07-15';
    expect(() => construirDte(doc, { caf: cafVencido(33), certificado, fechaFirma })).not.toThrow();
  });

  it('la boleta, la factura exenta y la guía no vencen', () => {
    for (const tipo of [34, 39, 41, 52] as const) {
      expect(() => construirDte(documentoDePrueba(tipo), { caf: cafVencido(tipo), certificado, fechaFirma })).not.toThrow();
    }
  });

  it('validarVigenciaCaf: false desactiva la validación', () => {
    expect(() =>
      construirDte(documentoDePrueba(33), { caf: cafVencido(33), certificado, fechaFirma, validarVigenciaCaf: false }),
    ).not.toThrow();
  });
});
