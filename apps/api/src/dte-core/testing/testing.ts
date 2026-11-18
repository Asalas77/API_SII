/**
 * UTILIDADES DE PRUEBA - NO USAR EN PRODUCCION.
 * Generan certificados y CAF ficticios para tests. El CAF de prueba NO esta firmado por el SII
 * (no tenemos su clave): el campo `FRMA` contiene bytes aleatorios, por lo que ese CAF jamas
 * seria aceptado por el SII, pero sirve para firmar/verificar TED localmente.
 */
import { generateKeyPairSync, randomBytes } from 'node:crypto';
import forge from 'node-forge';
import { OID_RUT_SAN } from '../certificado/certificado.js';

export interface OpcionesCertificadoPrueba {
  /** Common Name del sujeto. */
  nombre?: string;
  /** RUT a incluir en el SAN (otherName 1.3.6.1.4.1.8321.1), p. ej. `12345678-9`. */
  rut?: string;
  /** Dias de validez desde `desde` (por defecto 365). */
  dias?: number;
  /** Inicio de validez (por defecto, ayer). */
  desde?: Date;
}

export interface CertificadoPrueba {
  certificadoPem: string;
  clavePrivadaPem: string;
  clavePublicaPem: string;
}

function parRsa2048(): { privadaPem: string; publicaPem: string } {
  const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
  return {
    privadaPem: privateKey.export({ type: 'pkcs1', format: 'pem' }).toString(),
    publicaPem: publicKey.export({ type: 'spki', format: 'pem' }).toString(),
  };
}

function sanOtherNameRut(rut: string): string {
  const { asn1 } = forge;
  const otherName = asn1.create(asn1.Class.CONTEXT_SPECIFIC, 0, true, [
    asn1.create(asn1.Class.UNIVERSAL, asn1.Type.OID, false, asn1.oidToDer(OID_RUT_SAN).getBytes()),
    asn1.create(asn1.Class.CONTEXT_SPECIFIC, 0, true, [
      asn1.create(asn1.Class.UNIVERSAL, asn1.Type.IA5STRING, false, rut),
    ]),
  ]);
  return asn1.toDer(asn1.create(asn1.Class.UNIVERSAL, asn1.Type.SEQUENCE, true, [otherName])).getBytes();
}

/** Genera un certificado autofirmado RSA 2048 (SHA-256) para pruebas. */
export function generarCertificadoPrueba(opciones: OpcionesCertificadoPrueba = {}): CertificadoPrueba {
  const { privadaPem, publicaPem } = parRsa2048();
  const cert = forge.pki.createCertificate();
  cert.publicKey = forge.pki.publicKeyFromPem(publicaPem);
  cert.serialNumber = '01' + forge.util.bytesToHex(forge.random.getBytesSync(8));
  const desde = opciones.desde ?? new Date(Date.now() - 24 * 3600 * 1000);
  cert.validity.notBefore = desde;
  cert.validity.notAfter = new Date(desde.getTime() + (opciones.dias ?? 365) * 24 * 3600 * 1000);
  const attrs = [
    { name: 'commonName', value: opciones.nombre ?? 'Firmante de Prueba' },
    { name: 'countryName', value: 'CL' },
    { name: 'organizationName', value: 'Pruebas DTE' },
  ];
  cert.setSubject(attrs);
  cert.setIssuer(attrs);
  const extensiones: unknown[] = [
    { name: 'basicConstraints', cA: false },
    { name: 'keyUsage', digitalSignature: true, nonRepudiation: true },
  ];
  if (opciones.rut) {
    // forge no soporta otherName en altNames: se entrega el valor DER ya codificado.
    extensiones.push({ id: '2.5.29.17', critical: false, value: sanOtherNameRut(opciones.rut) });
  }
  cert.setExtensions(extensiones);
  cert.sign(forge.pki.privateKeyFromPem(privadaPem), forge.md.sha256.create());
  return {
    certificadoPem: forge.pki.certificateToPem(cert),
    clavePrivadaPem: privadaPem,
    clavePublicaPem: publicaPem,
  };
}

/** Genera un PFX (PKCS#12) de prueba protegido con `password`. */
export function generarPfxPrueba(password: string, opciones: OpcionesCertificadoPrueba = {}): Buffer {
  const c = generarCertificadoPrueba(opciones);
  const p12 = forge.pkcs12.toPkcs12Asn1(
    forge.pki.privateKeyFromPem(c.clavePrivadaPem),
    [forge.pki.certificateFromPem(c.certificadoPem)],
    password,
    { algorithm: '3des', friendlyName: 'prueba' },
  );
  return Buffer.from(forge.asn1.toDer(p12).getBytes(), 'binary');
}

export interface OpcionesCafPrueba {
  tipoDte: number;
  folioDesde: number;
  folioHasta: number;
  rutEmisor: string;
  razonSocial?: string;
  /** Fecha de autorizacion `yyyy-mm-dd` (por defecto, hoy). */
  fechaAutorizacion?: string;
  idk?: number;
}

/** Genera un archivo CAF ficticio (XML) con par RSA 2048 real y FRMA aleatorio (no valido ante el SII). */
export function generarCafPrueba(o: OpcionesCafPrueba): string {
  const { privadaPem, publicaPem } = parRsa2048();
  const pub = forge.pki.publicKeyFromPem(publicaPem) as forge.pki.rsa.PublicKey;
  const b64 = (n: { toString(base: number): string }) => {
    let hex = n.toString(16);
    if (hex.length % 2) hex = '0' + hex;
    return forge.util.encode64(forge.util.hexToBytes(hex));
  };
  const fa = o.fechaAutorizacion ?? new Date().toISOString().slice(0, 10);
  const frma = randomBytes(256).toString('base64');
  const da =
    `<DA><RE>${o.rutEmisor}</RE><RS>${o.razonSocial ?? 'EMPRESA DE PRUEBA SPA'}</RS><TD>${o.tipoDte}</TD>` +
    `<RNG><D>${o.folioDesde}</D><H>${o.folioHasta}</H></RNG><FA>${fa}</FA>` +
    `<RSAPK><M>${b64(pub.n)}</M><E>${b64(pub.e)}</E></RSAPK><IDK>${o.idk ?? 300}</IDK></DA>`;
  return (
    `<?xml version="1.0"?>\n<AUTORIZACION><CAF version="1.0">${da}` +
    `<FRMA algoritmo="SHA1withRSA">${frma}</FRMA></CAF>` +
    `<RSASK>${privadaPem.trim()}\n</RSASK><RSAPUBK>${publicaPem.trim()}\n</RSAPUBK></AUTORIZACION>`
  );
}
