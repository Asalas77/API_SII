export type TipoImagen = 'image/png' | 'image/jpeg';

/** Tamaño máximo del logo. */
export const LIMITE_LOGO_BYTES = 300 * 1024;

const FIRMA_PNG = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
const FIRMA_JPEG = [0xff, 0xd8, 0xff];

/** Detecta PNG o JPEG por los bytes iniciales (no por extensión ni `Content-Type`); `null` si es otra cosa. */
export function detectarImagen(buffer: Buffer): TipoImagen | null {
  const empieza = (firma: number[]) =>
    buffer.length >= firma.length && firma.every((b, i) => buffer[i] === b);
  if (empieza(FIRMA_PNG)) return 'image/png';
  if (empieza(FIRMA_JPEG)) return 'image/jpeg';
  return null;
}

/** Mayúsculas, sin espacios sobrantes; vacío -> `null`. */
export function normalizarUnidadSii(valor: string | null | undefined): string | null {
  if (valor === null || valor === undefined) return null;
  const limpio = valor.trim().replace(/\s+/g, ' ').toUpperCase();
  return limpio === '' ? null : limpio;
}

const MARCADORES = ['id', 'tipo', 'folio', 'rutEmisor'] as const;
const REGEX_MARCADOR = /\{([^{}]*)\}/g;

/** `null` si la plantilla es válida; si no, el motivo. Debe ser http/https y solo usar los marcadores conocidos. */
export function validarPlantillaUrl(plantilla: string): string | null {
  let desconocido: string | undefined;
  const probe = plantilla.replace(REGEX_MARCADOR, (_m, nombre: string) => {
    if (!(MARCADORES as readonly string[]).includes(nombre)) desconocido ??= nombre;
    return 'x';
  });
  if (desconocido !== undefined) {
    return `marcador desconocido {${desconocido}}; use ${MARCADORES.map((m) => `{${m}}`).join(', ')}`;
  }
  if (/[{}]/.test(probe)) return 'llaves sin cerrar';
  let url: URL;
  try {
    url = new URL(probe);
  } catch {
    return 'no es una URL válida';
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return 'debe ser http o https';
  return null;
}

export interface ValoresUrl {
  id: string;
  tipo: number;
  folio: number;
  rutEmisor: string;
}

/** Reemplaza los marcadores de la plantilla por los valores del documento, codificados para URL. */
export function resolverUrlVerificacion(plantilla: string, v: ValoresUrl): string {
  return plantilla.replace(REGEX_MARCADOR, (m, nombre: string) =>
    (MARCADORES as readonly string[]).includes(nombre)
      ? encodeURIComponent(String(v[nombre as keyof ValoresUrl]))
      : m,
  );
}
