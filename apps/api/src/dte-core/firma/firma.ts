import { X509Certificate } from 'node:crypto';
import { DOMParser } from '@xmldom/xmldom';
import { SignedXml } from 'xml-crypto';

export const NS_XMLDSIG = 'http://www.w3.org/2000/09/xmldsig#';
const ALG_C14N = 'http://www.w3.org/TR/2001/REC-xml-c14n-20010315';
const ALG_FIRMA = 'http://www.w3.org/2000/09/xmldsig#rsa-sha1';
const ALG_DIGEST = 'http://www.w3.org/2000/09/xmldsig#sha1';
const ALG_ENVELOPED = 'http://www.w3.org/2000/09/xmldsig#enveloped-signature';

export interface OpcionesFirma {
  /** Certificado X.509 del firmante (PEM). */
  certificadoPem: string;
  /** Clave privada del firmante (PEM, PKCS#1 o PKCS#8). */
  clavePrivadaPem: string;
  /** Valor del atributo `ID` del elemento a firmar (p. ej. `F33T1` o `SetDoc`). */
  idReferencia: string;
}

export interface ResultadoVerificacionFirma {
  valida: boolean;
  errores: string[];
}

/** Base64 estándar (no url-safe) de un valor base64url. */
function base64urlABase64(v: string): string {
  const b = v.replace(/-/g, '+').replace(/_/g, '/');
  return b + '='.repeat((4 - (b.length % 4)) % 4);
}

/** Contenido DER del certificado en base64, sin cabeceras PEM ni saltos de línea. */
export function certificadoABase64(pem: string): string {
  return new X509Certificate(pem).raw.toString('base64');
}

/**
 * Contenido de `<KeyInfo>` exigido por `xmldsignature_v10.xsd`:
 * `KeyValue/RSAKeyValue(Modulus, Exponent)` seguido de `X509Data/X509Certificate`.
 * Se emite sin prefijo: hereda el namespace por defecto de `<Signature>`.
 */
function contenidoKeyInfo(certificadoPem: string): string {
  const cert = new X509Certificate(certificadoPem);
  const jwk = cert.publicKey.export({ format: 'jwk' });
  if (jwk.kty !== 'RSA' || !jwk.n || !jwk.e) throw new Error('El certificado no contiene una clave pública RSA');
  return (
    '<KeyValue><RSAKeyValue>' +
    `<Modulus>${base64urlABase64(jwk.n)}</Modulus><Exponent>${base64urlABase64(jwk.e)}</Exponent>` +
    '</RSAKeyValue></KeyValue>' +
    `<X509Data><X509Certificate>${cert.raw.toString('base64')}</X509Certificate></X509Data>`
  );
}

/**
 * Firma XMLDSig *enveloped* (RSA-SHA1, C14N 1.0, digest SHA1) del elemento con `ID = idReferencia`.
 * La `<Signature>` queda como último hijo del elemento raíz, sin prefijo de namespace.
 */
export function firmarXml(xml: string, opciones: OpcionesFirma): string {
  const { certificadoPem, clavePrivadaPem, idReferencia } = opciones;
  if (!/^[A-Za-z_][\w.-]*$/.test(idReferencia)) throw new Error(`idReferencia inválido: ${idReferencia}`);
  const keyInfo = contenidoKeyInfo(certificadoPem);

  const sig = new SignedXml({
    privateKey: clavePrivadaPem,
    publicCert: certificadoPem,
    signatureAlgorithm: ALG_FIRMA,
    canonicalizationAlgorithm: ALG_C14N,
    getKeyInfoContent: () => keyInfo,
  });
  sig.addReference({
    xpath: `//*[@ID='${idReferencia}']`,
    transforms: [ALG_ENVELOPED],
    digestAlgorithm: ALG_DIGEST,
    uri: `#${idReferencia}`,
    isEmptyUri: false,
  });
  // Se descarta cualquier declaración previa de ruido: se conserva tal cual el XML recibido.
  sig.computeSignature(xml, { location: { reference: '/*', action: 'append' } });
  return sig.getSignedXml();
}

/**
 * Verifica todas las firmas XMLDSig del documento usando el certificado embebido en `KeyInfo`.
 * `valida` es true solo si existe al menos una firma y todas verifican. No valida la cadena del certificado.
 */
export function verificarFirmaXml(xmlFirmado: string): ResultadoVerificacionFirma {
  const errores: string[] = [];
  let doc: Document;
  try {
    doc = new DOMParser({ onError: (nivel, msg) => { if (nivel !== 'warning') errores.push(`XML: ${msg}`); } })
      .parseFromString(xmlFirmado, 'text/xml') as unknown as Document;
  } catch (e) {
    return { valida: false, errores: [`XML mal formado: ${(e as Error).message}`] };
  }
  if (errores.length > 0) return { valida: false, errores };

  const firmas = Array.from(doc.getElementsByTagNameNS(NS_XMLDSIG, 'Signature'));
  if (firmas.length === 0) return { valida: false, errores: ['El documento no contiene elementos Signature'] };

  firmas.forEach((nodo, i) => {
    const etiqueta = `Firma ${i + 1}`;
    try {
      const cert = nodo.getElementsByTagNameNS(NS_XMLDSIG, 'X509Certificate')[0]?.textContent?.replace(/\s+/g, '');
      if (!cert) {
        errores.push(`${etiqueta}: KeyInfo no contiene X509Certificate`);
        return;
      }
      const pem = `-----BEGIN CERTIFICATE-----\n${cert.match(/.{1,64}/g)?.join('\n')}\n-----END CERTIFICATE-----`;
      const sig = new SignedXml({ publicCert: pem, getCertFromKeyInfo: () => null });
      sig.loadSignature(nodo as unknown as Node);
      if (!sig.checkSignature(xmlFirmado)) {
        errores.push(`${etiqueta}: firma inválida (digest o SignatureValue no coinciden)`);
      }
    } catch (e) {
      errores.push(`${etiqueta}: ${(e as Error).message}`);
    }
  });
  return { valida: errores.length === 0, errores };
}
