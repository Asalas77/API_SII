import { DOMParser } from '@xmldom/xmldom';
import { generarCertificadoPrueba } from '../testing/testing.js';
import { NS_XMLDSIG, firmarXml, verificarFirmaXml } from './firma.js';

const cert = generarCertificadoPrueba({ rut: '12345678-9' });
const dteXml =
  '<DTE xmlns="http://www.sii.cl/SiiDte" version="1.0"><Documento ID="F33T1"><Encabezado><IdDoc><TipoDTE>33</TipoDTE><Folio>1</Folio></IdDoc>' +
  '<Receptor><RznSocRecep>Ñandú &amp; Cía</RznSocRecep></Receptor></Encabezado></Documento></DTE>';

const firmar = (xml = dteXml, id = 'F33T1') =>
  firmarXml(xml, { certificadoPem: cert.certificadoPem, clavePrivadaPem: cert.clavePrivadaPem, idReferencia: id });

describe('firmarXml', () => {
  const firmado = firmar();
  const doc = new DOMParser().parseFromString(firmado, 'text/xml');
  const raiz = doc.documentElement!;
  const sig = Array.from(raiz.childNodes).find((n) => n.nodeType === 1 && (n as unknown as Element).localName === 'Signature') as unknown as Element;

  it('agrega Signature como último hijo de la raíz, sin prefijo, tras el elemento firmado', () => {
    expect(sig).toBeDefined();
    expect(sig.namespaceURI).toBe(NS_XMLDSIG);
    expect(sig.prefix).toBeNull();
    const hijos = Array.from(raiz.childNodes).filter((n) => n.nodeType === 1) as unknown as Element[];
    expect(hijos.map((h) => h.localName)).toEqual(['Documento', 'Signature']);
    expect(firmado).toContain('<Signature xmlns="http://www.w3.org/2000/09/xmldsig#">');
  });

  it('usa exactamente los algoritmos del SII y URI #id', () => {
    expect(firmado).toContain('<CanonicalizationMethod Algorithm="http://www.w3.org/TR/2001/REC-xml-c14n-20010315"/>');
    expect(firmado).toContain('<SignatureMethod Algorithm="http://www.w3.org/2000/09/xmldsig#rsa-sha1"/>');
    expect(firmado).toContain('<Reference URI="#F33T1">');
    expect(firmado).toContain('<Transform Algorithm="http://www.w3.org/2000/09/xmldsig#enveloped-signature"/>');
    expect(firmado).toContain('<DigestMethod Algorithm="http://www.w3.org/2000/09/xmldsig#sha1"/>');
    expect(firmado.match(/<Transform /g)).toHaveLength(1);
  });

  it('KeyInfo: KeyValue/RSAKeyValue(Modulus,Exponent) y luego X509Data/X509Certificate', () => {
    const ki = sig.getElementsByTagNameNS(NS_XMLDSIG, 'KeyInfo')[0];
    const nombres = Array.from(ki.childNodes).map((n) => (n as unknown as Element).localName);
    expect(nombres).toEqual(['KeyValue', 'X509Data']);
    const rsa = ki.getElementsByTagNameNS(NS_XMLDSIG, 'RSAKeyValue')[0];
    expect(Array.from(rsa.childNodes).map((n) => (n as unknown as Element).localName)).toEqual(['Modulus', 'Exponent']);
    const b64 = cert.certificadoPem.replace(/-----[^-]+-----|\s+/g, '');
    expect(ki.getElementsByTagNameNS(NS_XMLDSIG, 'X509Certificate')[0].textContent).toBe(b64);
    expect(firmado).not.toContain('-----BEGIN');
  });

  it('el documento firmado verifica', () => {
    expect(verificarFirmaXml(firmado)).toEqual({ valida: true, errores: [] });
  });

  it('un documento alterado no verifica', () => {
    const alterado = firmado.replace('<Folio>1</Folio>', '<Folio>2</Folio>');
    const r = verificarFirmaXml(alterado);
    expect(r.valida).toBe(false);
    expect(r.errores.length).toBeGreaterThan(0);
  });

  it('una SignatureValue alterada no verifica', () => {
    const alterado = firmado.replace(/<SignatureValue>.{4}/, '<SignatureValue>AAAA');
    expect(verificarFirmaXml(alterado).valida).toBe(false);
  });

  it('sin firma o XML mal formado no es válido', () => {
    expect(verificarFirmaXml(dteXml).valida).toBe(false);
    expect(verificarFirmaXml('<a><b></a>').valida).toBe(false);
  });

  it('firma SetDTE dentro de EnvioDTE y mantiene la firma interna del DTE', () => {
    const dteFirmado = firmar().replace(/^<\?xml[^>]*\?>/, '');
    const envio = `<EnvioDTE xmlns="http://www.sii.cl/SiiDte" version="1.0"><SetDTE ID="SetDoc"><Caratula version="1.0"><RutEmisor>1-9</RutEmisor></Caratula>${dteFirmado}</SetDTE></EnvioDTE>`;
    const envioFirmado = firmar(envio, 'SetDoc');
    expect(verificarFirmaXml(envioFirmado)).toEqual({ valida: true, errores: [] });
    expect(envioFirmado.match(/<Signature /g)).toHaveLength(2);
    // alterar el DTE interno invalida ambas firmas
    expect(verificarFirmaXml(envioFirmado.replace('<Folio>1</Folio>', '<Folio>9</Folio>')).valida).toBe(false);
  });

  it('rechaza idReferencia inválido o inexistente', () => {
    expect(() => firmar(dteXml, "x'] | //*[@ID='")).toThrow(/idReferencia/);
    expect(() => firmar(dteXml, 'NoExiste')).toThrow();
  });
});
