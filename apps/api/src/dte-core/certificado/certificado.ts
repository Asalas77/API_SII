import { createPrivateKey, X509Certificate } from 'node:crypto';
import forge from 'node-forge';

/** OID del RUT del titular en el subjectAltName (otherName) de certificados chilenos. */
export const OID_RUT_SAN = '1.3.6.1.4.1.8321.1';

export interface CertificadoFirmante {
  /** Certificado X.509 en PEM (con cabeceras). */
  certificadoPem: string;
  /** Clave privada en PEM PKCS#8 (compatible con `crypto.createPrivateKey`). */
  clavePrivadaPem: string;
  /** Common Name del sujeto (`undefined` si no existe). */
  sujeto: string | undefined;
  validoDesde: Date;
  validoHasta: Date;
  /** RUT del firmante (`12345678-9`) si el certificado lo trae en el SAN. */
  rutFirmante: string | undefined;
  /** Indica si el certificado está vigente en la fecha dada (por defecto, ahora). */
  vigente(fecha?: Date): boolean;
}

const TIPOS_STRING = [forge.asn1.Type.UTF8, forge.asn1.Type.PRINTABLESTRING, forge.asn1.Type.IA5STRING];

/** Busca recursivamente el primer string ASN.1 con forma de RUT dentro de un valor. */
function primerString(valor: forge.asn1.Asn1): string | undefined {
  if (Array.isArray(valor.value)) {
    for (const hijo of valor.value) {
      const r = primerString(hijo as forge.asn1.Asn1);
      if (r) return r;
    }
    return undefined;
  }
  if (typeof valor.value !== 'string') return undefined;
  if (valor.tagClass === forge.asn1.Class.UNIVERSAL && TIPOS_STRING.includes(valor.type)) {
    return forge.util.decodeUtf8(valor.value);
  }
  return undefined;
}

/** Extrae el RUT del otherName del SAN. Nunca lanza: devuelve `undefined` si falla. */
export function extraerRutDeSan(cert: forge.pki.Certificate): string | undefined {
  try {
    const ext = cert.getExtension('subjectAltName') as { value?: string } | null;
    if (!ext || typeof ext.value !== 'string') return undefined;
    const raiz = forge.asn1.fromDer(ext.value);
    const generales = (raiz.value as forge.asn1.Asn1[]) ?? [];
    for (const gn of generales) {
      // otherName = [0] { OID, [0] EXPLICIT valor }
      if (gn.tagClass !== forge.asn1.Class.CONTEXT_SPECIFIC || gn.type !== 0) continue;
      const partes = gn.value as forge.asn1.Asn1[];
      if (!Array.isArray(partes) || partes.length < 2) continue;
      const oid = forge.asn1.derToOid(partes[0].value as string);
      if (oid !== OID_RUT_SAN) continue;
      const texto = primerString(partes[1])?.trim();
      const m = texto ? /^0*(\d{1,9})-?([\dkK])$/.exec(texto.replace(/\./g, '')) : null;
      if (m) return `${m[1]}-${m[2].toUpperCase()}`;
    }
  } catch {
    /* sin RUT en el SAN */
  }
  return undefined;
}

/**
 * Carga un archivo PFX/PKCS#12 y devuelve certificado y clave en PEM más sus metadatos.
 * Lanza `Error` si la contraseña es incorrecta, el archivo es inválido o no contiene clave/certificado.
 */
export function cargarPfx(pfx: Buffer, password: string): CertificadoFirmante {
  let p12: forge.pkcs12.Pkcs12Pfx;
  try {
    const asn1 = forge.asn1.fromDer(forge.util.createBuffer(pfx.toString('binary')));
    p12 = forge.pkcs12.pkcs12FromAsn1(asn1, false, password);
  } catch (e) {
    throw new Error(`No se pudo abrir el PFX (¿contraseña incorrecta o archivo inválido?): ${(e as Error).message}`);
  }

  const oidShrouded = forge.pki.oids.pkcs8ShroudedKeyBag as string;
  const oidKey = forge.pki.oids.keyBag as string;
  const oidCert = forge.pki.oids.certBag as string;
  const claves = [
    ...(p12.getBags({ bagType: oidShrouded })[oidShrouded] ?? []),
    ...(p12.getBags({ bagType: oidKey })[oidKey] ?? []),
  ];
  const certs = p12.getBags({ bagType: oidCert })[oidCert] ?? [];
  const clave = claves.find((b) => b.key)?.key as forge.pki.rsa.PrivateKey | undefined;
  if (!clave) throw new Error('El PFX no contiene una clave privada');
  if (certs.length === 0) throw new Error('El PFX no contiene certificados');

  // Elige el certificado cuya clave pública coincide con la privada (el resto serían la cadena).
  const modulo = clave.n.toString(16);
  const bag =
    certs.find((b) => {
      const pk = b.cert?.publicKey as forge.pki.rsa.PublicKey | undefined;
      return pk?.n?.toString(16) === modulo;
    }) ?? certs[0];
  const cert = bag.cert as forge.pki.Certificate;

  const clavePrivadaPem = createPrivateKey(forge.pki.privateKeyToPem(clave))
    .export({ type: 'pkcs8', format: 'pem' })
    .toString();
  const certificadoPem = forge.pki.certificateToPem(cert);
  const validoDesde = cert.validity.notBefore;
  const validoHasta = cert.validity.notAfter;

  return {
    certificadoPem,
    clavePrivadaPem,
    sujeto: (cert.subject.getField('CN')?.value as string | undefined) ?? undefined,
    validoDesde,
    validoHasta,
    rutFirmante: extraerRutDeSan(cert),
    vigente(fecha: Date = new Date()) {
      return fecha >= validoDesde && fecha <= validoHasta;
    },
  };
}

/** Comprueba que un PEM de certificado es parseable por `node:crypto`. */
export function certificadoEsValido(certificadoPem: string): boolean {
  try {
    return new X509Certificate(certificadoPem).validTo.length > 0;
  } catch {
    return false;
  }
}
