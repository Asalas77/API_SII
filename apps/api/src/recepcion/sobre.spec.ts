import { aIso88591, construirDte, construirEnvioDte, parsearCaf } from '../dte-core/index.js';
import { documentoDePrueba } from '../dte-core/testing/documentos-prueba.js';
import { generarCertificadoPrueba } from '../dte-core/testing/testing.js';
import { generarCafRealista } from '../testing/caf-realista.js';
import { datosDeDte, decodificarXml, extraerDtesDeSobre, fechaFirmaDeSobre, hashArchivo, rutEmisorDeCaratula } from './sobre.js';

const cert = generarCertificadoPrueba({ rut: '11111111-1' });
const caf = parsearCaf(generarCafRealista({ tipoDte: 33, folioDesde: 1, folioHasta: 50, rutEmisor: '76086428-5' }));
const fechaFirma = new Date('2026-02-02T13:00:00Z');
const dte = (folio: number) => construirDte(documentoDePrueba(33, folio), { caf, certificado: cert, fechaFirma }).xmlFirmado;
const sobre = (dtes: string[]) =>
  construirEnvioDte({
    dtesFirmados: dtes,
    caratula: {
      rutEmisor: '76086428',
      dvEmisor: '5',
      rutEnvia: '11111111',
      dvEnvia: '1',
      rutReceptor: '12345678-5',
      fechaResolucion: '2025-01-15',
      numeroResolucion: 80,
      fechaFirma,
    },
    certificado: cert,
  });

describe('deduplicación por hash del archivo', () => {
  it('el mismo contenido da el mismo SHA-256 y cualquier byte distinto, otro', () => {
    const a = Buffer.from(sobre([dte(1)]).xmlIso);
    expect(hashArchivo(a)).toMatch(/^[0-9a-f]{64}$/);
    expect(hashArchivo(a)).toBe(hashArchivo(Buffer.from(a)));
    const b = Buffer.from(a);
    b[b.length - 5] ^= 0x01;
    expect(hashArchivo(b)).not.toBe(hashArchivo(a));
  });

  it('es el hash de los bytes tal cual llegaron: no depende de la codificación ni de normalizaciones', () => {
    const xml = '<?xml version="1.0" encoding="ISO-8859-1"?><A>Ñandú</A>';
    const latin1 = aIso88591(xml);
    const utf8 = Buffer.from(xml, 'utf8');
    expect(hashArchivo(latin1)).not.toBe(hashArchivo(utf8));
    expect(hashArchivo(Buffer.from('a\r\nb'))).not.toBe(hashArchivo(Buffer.from('a\nb')));
  });
});

describe('lectura del sobre', () => {
  const envio = sobre([dte(1), dte(2)]);

  it('extrae cada DTE textual (la firma de cada uno sigue siendo verificable)', () => {
    const dtes = extraerDtesDeSobre(decodificarXml(envio.xmlIso));
    expect(dtes).toHaveLength(2);
    expect(dtes[0]).toContain('<Folio>1</Folio>');
    expect(dtes[1]).toContain('<Folio>2</Folio>');
    for (const d of dtes) expect(d.startsWith('<DTE')).toBe(true);
  });

  it('decodifica ISO-8859-1 (por defecto) y UTF-8 (declarado o con BOM)', () => {
    expect(decodificarXml(aIso88591('<A>Ñandú</A>'))).toContain('Ñandú');
    expect(decodificarXml(Buffer.from('<?xml version="1.0" encoding="UTF-8"?><A>Ñandú</A>', 'utf8'))).toContain('Ñandú');
    expect(decodificarXml(Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from('<A>Ñ</A>', 'utf8')]))).toBe('<A>Ñ</A>');
  });

  it('lee la carátula aunque el sobre no valide', () => {
    const t = decodificarXml(envio.xmlIso);
    expect(rutEmisorDeCaratula(t)).toBe('76086428-5');
    expect(rutEmisorDeCaratula('<EnvioDTE></EnvioDTE>')).toBeUndefined();
    expect(fechaFirmaDeSobre(t)?.getTime()).toBeGreaterThan(0);
    expect(fechaFirmaDeSobre('<x/>')).toBeUndefined();
  });

  it('datos del DTE: emisor y desglose de montos', () => {
    const d = datosDeDte(extraerDtesDeSobre(decodificarXml(envio.xmlIso))[0]);
    expect(d).toMatchObject({ razonSocialEmisor: 'EMPRESA DE PRUEBA SPA', montoNeto: 1000, iva: 190, otrosImpuestos: [] });
  });
});
