import { DOMParser } from '@xmldom/xmldom';
import { generarCertificadoPrueba } from '../testing/testing.js';
import { NS_XMLDSIG, firmarDocumentoCompleto, firmarXml, verificarFirmaXml } from './firma.js';

const cert = generarCertificadoPrueba({ rut: '12345678-9' });
const semilla =
  '<?xml version="1.0" encoding="UTF-8"?>\n<getToken><item><Semilla>1234567890123</Semilla></item></getToken>';

describe('firmarDocumentoCompleto (semilla)', () => {
  const firmado = firmarDocumentoCompleto(semilla, cert);

  it('conserva exactamente dos líneas y no agrega saltos finales', () => {
    expect(firmado.split('\n')).toHaveLength(2);
    expect(firmado.startsWith('<?xml version="1.0" encoding="UTF-8"?>\n<getToken><item><Semilla>1234567890123</Semilla></item>')).toBe(true);
    expect(firmado.endsWith('</Signature></getToken>')).toBe(true);
  });

  it('sigue la estructura del ejemplo del SII (Reference URI vacío, enveloped, rsa-sha1, c14n)', () => {
    expect(firmado).toContain('<Signature xmlns="http://www.w3.org/2000/09/xmldsig#">');
    expect(firmado).toContain('<Reference URI="">');
    expect(firmado).toContain('<CanonicalizationMethod Algorithm="http://www.w3.org/TR/2001/REC-xml-c14n-20010315"/>');
    expect(firmado).toContain('<SignatureMethod Algorithm="http://www.w3.org/2000/09/xmldsig#rsa-sha1"/>');
    expect(firmado).toContain('<Transform Algorithm="http://www.w3.org/2000/09/xmldsig#enveloped-signature"/>');
    expect(firmado).toContain('<DigestMethod Algorithm="http://www.w3.org/2000/09/xmldsig#sha1"/>');
    const doc = new DOMParser().parseFromString(firmado, 'text/xml');
    const hijos = Array.from(doc.documentElement!.childNodes).filter((n) => n.nodeType === 1) as unknown as Element[];
    expect(hijos.map((h) => h.localName)).toEqual(['item', 'Signature']);
    const sig = hijos[1];
    expect(Array.from(sig.childNodes).map((n) => (n as unknown as Element).localName)).toEqual([
      'SignedInfo',
      'SignatureValue',
      'KeyInfo',
    ]);
    const ki = sig.getElementsByTagNameNS(NS_XMLDSIG, 'KeyInfo')[0];
    expect(Array.from(ki.childNodes).map((n) => (n as unknown as Element).localName)).toEqual(['KeyValue', 'X509Data']);
  });

  it('verifica, y deja de verificar si se altera la semilla', () => {
    expect(verificarFirmaXml(firmado)).toEqual({ valida: true, errores: [] });
    expect(verificarFirmaXml(firmado.replace('1234567890123', '1234567890124')).valida).toBe(false);
  });

  it('funciona sin declaración XML', () => {
    const f = firmarDocumentoCompleto('<getToken><item><Semilla>10</Semilla></item></getToken>', cert);
    expect(f.startsWith('<getToken>')).toBe(true);
    expect(verificarFirmaXml(f).valida).toBe(true);
  });

  it('firmarXml por ID sigue funcionando igual', () => {
    const f = firmarXml('<a><b ID="x">1</b></a>', { ...cert, idReferencia: 'x' });
    expect(f).toContain('<Reference URI="#x">');
    expect(verificarFirmaXml(f).valida).toBe(true);
  });
});
