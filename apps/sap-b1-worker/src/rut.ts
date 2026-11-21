/** Utilidades de RUT chileno. */

/** Dígito verificador (módulo 11) del cuerpo numérico del RUT. */
export function calcularDv(cuerpo: string): string {
  let suma = 0;
  let factor = 2;
  for (let i = cuerpo.length - 1; i >= 0; i--) {
    suma += Number(cuerpo[i]) * factor;
    factor = factor === 7 ? 2 : factor + 1;
  }
  const resto = 11 - (suma % 11);
  if (resto === 11) return '0';
  if (resto === 10) return 'K';
  return String(resto);
}

/**
 * Normaliza y valida un RUT (`76.086.428-5`, `76086428-5`, `760864285`). Devuelve `cuerpo-DV` sin
 * puntos ni ceros a la izquierda, o `null` si no tiene formato o el DV no corresponde.
 */
export function normalizarRut(valor: string | null | undefined): string | null {
  if (!valor) return null;
  const limpio = valor.replace(/[.\s]/g, '').toUpperCase();
  const m = /^(\d{1,9})-?([\dK])$/.exec(limpio);
  if (!m) return null;
  const cuerpo = String(Number(m[1]));
  if (cuerpo === '0') return null;
  const dv = m[2] as string;
  return calcularDv(cuerpo) === dv ? `${cuerpo}-${dv}` : null;
}

export const RUT_GENERICO = '66666666-6';
