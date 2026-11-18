/**
 * Utilidades SOLO para tests (no se exportan desde index.ts).
 */
import type { FirmadorXml } from './firmador.js';
import type { AlmacenToken } from './http.js';

export type RespuestaSimulada = Response | Error | ((url: string, init?: RequestInit) => Response);

/** Crea un fetch simulado que consume `respuestas` en orden. */
export function crearFetchSimulado(respuestas: RespuestaSimulada[]) {
  const cola = [...respuestas];
  const fn = vi.fn(async (url: string, init?: RequestInit): Promise<Response> => {
    const siguiente = cola.shift();
    if (siguiente === undefined) throw new Error(`Sin respuesta simulada para ${url}`);
    if (siguiente instanceof Error) throw siguiente;
    return typeof siguiente === 'function' ? siguiente(url, init) : siguiente;
  });
  return fn;
}

export function resp(cuerpo: string, status = 200, contentType = 'application/xml'): Response {
  return new Response(cuerpo, { status, headers: { 'Content-Type': contentType } });
}

export function respJson(obj: unknown, status = 200): Response {
  return resp(JSON.stringify(obj), status, 'application/json');
}

/** Firmador falso que marca el XML para poder verificarlo. */
export function crearFirmadorFalso() {
  return {
    firmarXml: vi.fn((xml: string) => `${xml}<!--firmado-->`),
  } satisfies FirmadorXml;
}

export function almacenNuevo(): AlmacenToken {
  return new Map();
}

export const sinEspera = () => vi.fn(async (_ms: number) => {});

export function cabecera(init: RequestInit | undefined, nombre: string): string | undefined {
  const h = init?.headers as Record<string, string> | undefined;
  if (!h) return undefined;
  const k = Object.keys(h).find((x) => x.toLowerCase() === nombre.toLowerCase());
  return k ? h[k] : undefined;
}
