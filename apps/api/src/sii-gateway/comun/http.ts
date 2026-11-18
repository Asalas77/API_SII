import type { AmbienteSii } from '../ambientes.js';
import { USER_AGENT_SII } from '../ambientes.js';
import {
  SiiAutenticacionError,
  SiiLimiteExcedidoError,
  SiiRedError,
  SiiServidorError,
  errorDesdeHttp,
} from './errores.js';
import { codificarXml } from './xml.js';

/** Firma de `fetch` inyectable (por defecto `globalThis.fetch`). */
export type FetchImpl = (input: string, init?: RequestInit) => Promise<Response>;

export type RutLike = string | number;

/** Quita puntos, guiones y espacios de un RUT sin dígito verificador. */
export function normalizarRut(rut: RutLike): string {
  return String(rut).replace(/[.\s-]/g, '');
}

// ---------------------------------------------------------------------------
// Reintentos con backoff exponencial
// ---------------------------------------------------------------------------

export interface OpcionesReintento {
  /** Intentos totales (incluye el primero). Por defecto 3. */
  maxIntentos?: number;
  /** Espera inicial en ms; se multiplica por `factor` en cada reintento. Por defecto 500. */
  esperaBaseMs?: number;
  /** Factor del backoff exponencial. Por defecto 2. */
  factor?: number;
  /** Función de espera (inyectable para tests). */
  esperar?: (ms: number) => Promise<void>;
}

const esperaReal = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

export function esReintentable(e: unknown): boolean {
  return (
    e instanceof SiiLimiteExcedidoError ||
    e instanceof SiiServidorError ||
    e instanceof SiiRedError
  );
}

/** Reintenta `op` solo para 405, 5xx y errores de red. */
export async function conReintentos<T>(
  op: () => Promise<T>,
  opciones: OpcionesReintento = {},
): Promise<T> {
  const max = Math.max(1, opciones.maxIntentos ?? 3);
  const base = opciones.esperaBaseMs ?? 500;
  const factor = opciones.factor ?? 2;
  const esperar = opciones.esperar ?? esperaReal;
  for (let intento = 1; ; intento++) {
    try {
      return await op();
    } catch (e) {
      if (intento >= max || !esReintentable(e)) throw e;
      await esperar(base * factor ** (intento - 1));
    }
  }
}

/**
 * Ejecuta un request: traduce fallos de red y respuestas no 2xx a errores
 * tipados, con reintentos para 405/5xx/red.
 */
export function solicitar(
  fetchImpl: FetchImpl,
  url: string,
  init: RequestInit,
  contexto: string,
  reintentos?: OpcionesReintento,
): Promise<Response> {
  return conReintentos(async () => {
    let resp: Response;
    try {
      resp = await fetchImpl(url, init);
    } catch (e) {
      throw new SiiRedError(`${contexto}: fallo de red`, { cause: e });
    }
    if (!resp.ok) {
      throw errorDesdeHttp(resp.status, await resp.text().catch(() => ''), contexto);
    }
    return resp;
  }, reintentos);
}

// ---------------------------------------------------------------------------
// Caché de token
// ---------------------------------------------------------------------------

export type AlmacenToken = Map<string, { token: string; expiraEn: number }>;

export interface OpcionesCacheToken {
  /** Vida del token en caché. Por defecto 50 minutos (el SII lo da por 1 hora). */
  ttlMs?: number;
  /** Almacén compartido; por defecto uno global del proceso. */
  almacen?: AlmacenToken;
  /** Reloj inyectable (ms epoch). */
  ahora?: () => number;
}

export const TTL_TOKEN_POR_DEFECTO_MS = 50 * 60 * 1000;
const almacenGlobal: AlmacenToken = new Map();

/**
 * Caché en memoria del token por (tipo, ambiente, rutEmpresa), con
 * deduplicación de peticiones concurrentes.
 */
export class GestorToken {
  private readonly clave: string;
  private readonly ttlMs: number;
  private readonly almacen: AlmacenToken;
  private readonly ahora: () => number;
  private enCurso?: Promise<string>;

  constructor(
    tipo: 'boleta' | 'dte',
    ambiente: AmbienteSii,
    rutEmpresa: RutLike,
    opciones: OpcionesCacheToken | false = {},
  ) {
    this.clave = `${tipo}|${ambiente}|${normalizarRut(rutEmpresa)}`;
    const o = opciones === false ? { ttlMs: 0 } : opciones;
    this.ttlMs = o.ttlMs ?? TTL_TOKEN_POR_DEFECTO_MS;
    this.almacen = o.almacen ?? almacenGlobal;
    this.ahora = o.ahora ?? Date.now;
  }

  async obtener(generar: () => Promise<string>): Promise<string> {
    const hit = this.almacen.get(this.clave);
    if (hit && hit.expiraEn > this.ahora()) return hit.token;
    this.enCurso ??= generar()
      .then((token) => {
        if (this.ttlMs > 0) {
          this.almacen.set(this.clave, { token, expiraEn: this.ahora() + this.ttlMs });
        }
        return token;
      })
      .finally(() => {
        this.enCurso = undefined;
      });
    return this.enCurso;
  }

  invalidar(): void {
    this.almacen.delete(this.clave);
  }

  /**
   * Ejecuta `operacion` con el token vigente; si el SII responde
   * "no autenticado" (401), renueva el token una vez y repite.
   */
  async conToken<T>(
    generar: () => Promise<string>,
    operacion: (token: string) => Promise<T>,
  ): Promise<T> {
    const token = await this.obtener(generar);
    try {
      return await operacion(token);
    } catch (e) {
      if (!(e instanceof SiiAutenticacionError)) throw e;
      this.invalidar();
      return operacion(await this.obtener(generar));
    }
  }
}

// ---------------------------------------------------------------------------
// Multipart
// ---------------------------------------------------------------------------

export interface CamposEnvio {
  rutSender: string;
  dvSender: string;
  rutCompany: string;
  dvCompany: string;
}

/** Arma el multipart exigido por DTEUpload y boleta.electronica.envio. */
export function construirMultipartEnvio(
  campos: CamposEnvio,
  xml: string | Uint8Array,
  nombreArchivo: string,
  contentType = 'application/xml',
): FormData {
  const form = new FormData();
  form.append('rutSender', campos.rutSender);
  form.append('dvSender', campos.dvSender);
  form.append('rutCompany', campos.rutCompany);
  form.append('dvCompany', campos.dvCompany);
  const nombre = /\.xml$/i.test(nombreArchivo) ? nombreArchivo : `${nombreArchivo}.xml`;
  const bytes = codificarXml(xml);
  form.append(
    'archivo',
    new Blob([bytes as BlobPart], { type: contentType }),
    nombre,
  );
  return form;
}

/** Headers comunes de los envíos autenticados al SII. */
export function headersEnvio(token: string, accept: string): Record<string, string> {
  return {
    'User-Agent': USER_AGENT_SII,
    Cookie: `TOKEN=${token}`,
    Accept: accept,
  };
}
