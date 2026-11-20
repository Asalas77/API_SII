import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';

export type AmbienteClave = 'test' | 'live';

const LARGO_PREFIJO_BYTES = 5; // 10 caracteres hex
const LARGO_SECRETO_BYTES = 32;
const FORMATO = /^sk_(test|live)_([0-9a-f]{10})_([A-Za-z0-9_-]{43,})$/;

export interface ClaveGenerada {
  /** Clave completa: se muestra una sola vez. */
  clave: string;
  prefijo: string;
  hash: string;
}

/** Hash SHA-256 (hex) de la clave completa; es lo único que se guarda. */
export function hashearClave(clave: string): string {
  return createHash('sha256').update(clave).digest('hex');
}

/** `sk_<test|live>_<prefijo>_<secreto base64url de 32 bytes>`. */
export function generarApiKey(ambiente: AmbienteClave): ClaveGenerada {
  const prefijo = randomBytes(LARGO_PREFIJO_BYTES).toString('hex');
  const secreto = randomBytes(LARGO_SECRETO_BYTES).toString('base64url');
  const clave = `sk_${ambiente}_${prefijo}_${secreto}`;
  return { clave, prefijo, hash: hashearClave(clave) };
}

/** Separa una clave con formato válido; `undefined` si no lo tiene (no consulta nada). */
export function parsearApiKey(
  clave: string,
): { ambiente: AmbienteClave; prefijo: string } | undefined {
  const m = FORMATO.exec(clave);
  return m ? { ambiente: m[1] as AmbienteClave, prefijo: m[2] } : undefined;
}

/** Compara en tiempo constante dos cadenas de cualquier largo (vía su SHA-256). */
export function igualesEnTiempoConstante(a: string, b: string): boolean {
  return timingSafeEqual(
    createHash('sha256').update(a).digest(),
    createHash('sha256').update(b).digest(),
  );
}

/** ¿La clave presentada corresponde al hash hex almacenado? */
export function verificarClave(clave: string, hashAlmacenado: string): boolean {
  const esperado = Buffer.from(hashAlmacenado, 'hex');
  const real = createHash('sha256').update(clave).digest();
  return esperado.length === real.length && timingSafeEqual(esperado, real);
}
