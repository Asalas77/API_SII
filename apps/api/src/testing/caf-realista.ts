/**
 * UTILIDAD DE PRUEBA - NO USAR EN PRODUCCION.
 * CAF ficticio con claves RSA de 512 bits y FRMA de 64 bytes, como los CAF reales del SII.
 * `generarCafPrueba` de dte-core usa RSA 2048 y su TED (~1.500 bytes) no cabe en un PDF417.
 */
import { generateKeyPairSync, randomBytes } from 'node:crypto';

export interface OpcionesCafRealista {
  tipoDte: number;
  folioDesde: number;
  folioHasta: number;
  rutEmisor: string;
  razonSocial?: string;
  /** `yyyy-mm-dd`; por defecto hoy. */
  fechaAutorizacion?: string;
}

export function generarCafRealista(o: OpcionesCafRealista): string {
  const { privateKey, publicKey } = generateKeyPairSync('rsa', {
    modulusLength: 512,
  });
  const jwk = publicKey.export({ format: 'jwk' });
  const b64 = (u: string | undefined) =>
    Buffer.from(u ?? '', 'base64url').toString('base64');
  const fa = o.fechaAutorizacion ?? new Date().toISOString().slice(0, 10);
  return (
    `<?xml version="1.0"?>\n<AUTORIZACION><CAF version="1.0"><DA><RE>${o.rutEmisor}</RE>` +
    `<RS>${o.razonSocial ?? 'EMPRESA DE PRUEBA SPA'}</RS><TD>${o.tipoDte}</TD>` +
    `<RNG><D>${o.folioDesde}</D><H>${o.folioHasta}</H></RNG><FA>${fa}</FA>` +
    `<RSAPK><M>${b64(jwk.n)}</M><E>${b64(jwk.e)}</E></RSAPK><IDK>300</IDK></DA>` +
    `<FRMA algoritmo="SHA1withRSA">${randomBytes(64).toString('base64')}</FRMA></CAF>` +
    `<RSASK>${privateKey.export({ type: 'pkcs1', format: 'pem' }).toString().trim()}\n</RSASK>` +
    `<RSAPUBK>${publicKey.export({ type: 'spki', format: 'pem' }).toString().trim()}\n</RSAPUBK></AUTORIZACION>`
  );
}
