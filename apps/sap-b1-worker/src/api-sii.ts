import type { Config } from './config.js';
import type { CuerpoDocumento } from './mapeador.js';

/** Error de la API en formato problem+json. */
export class ErrorApi extends Error {
  constructor(
    readonly status: number,
    readonly codigo: string,
    readonly titulo: string,
    readonly detalle: string,
    readonly errores: Array<{ campo?: string; mensaje: string }> = [],
  ) {
    super(`${status} ${codigo}: ${detalle}`);
    this.name = 'ErrorApi';
  }

  /** Texto para `U_SII_Glosa`: código, detalle y errores por campo. */
  glosa(): string {
    const lineas = this.errores.map((e) => (e.campo ? `${e.campo}: ${e.mensaje}` : e.mensaje));
    return [`${this.codigo}: ${this.detalle}`, ...lineas].join('\n');
  }
}

/** Fallo de red o timeout hablando con la API. */
export class ErrorRedApi extends Error {
  constructor(mensaje: string) {
    super(mensaje);
    this.name = 'ErrorRedApi';
  }
}

/**
 * Un error es definitivo (el documento pasa a `ERROR` y no se reintenta) cuando la API rechazó el
 * contenido: 400, 409, 413 y 422. Todo lo demás (red, 5xx, 429, 401/403 por configuración, 404 de
 * empresa) es transitorio: el documento queda `ENVIANDO` y se reintenta con la misma clave.
 */
export function esErrorDefinitivo(e: unknown): e is ErrorApi {
  return e instanceof ErrorApi && [400, 409, 413, 422].includes(e.status);
}

export interface DocumentoApi {
  id: string;
  empresa?: string;
  tipoDte: number;
  folio: number;
  fechaEmision?: string;
  estado: string;
  trackId: string | null;
  reparos?: unknown;
  estadoSii?: string | null;
  glosaSii?: string | null;
  enlaces?: { xml: string; pdf: string };
}

export interface ResultadoEmision {
  documento: DocumentoApi;
  /** true si la API devolvió el documento ya emitido (200 + `Idempotent-Replayed`). */
  repetido: boolean;
}

export interface EnvioApi {
  id: string;
  canal: string;
  trackId: string | null;
  estado: string | null;
  documentos: Array<{ documentoId: string; tipoDte: number; folio: number }>;
}

export interface EstadoConsultado {
  documento: DocumentoApi;
  estadoSii: string | null;
  glosaSii: string | null;
  esFinal: boolean;
  descripcionEstado?: string;
  advertencia?: string;
}

export interface ApiDte {
  emitir(rut: string, cuerpo: CuerpoDocumento, claveIdempotencia: string): Promise<ResultadoEmision>;
  crearEnvio(rut: string, documentoIds: string[]): Promise<EnvioApi[]>;
  consultarEstado(documentoId: string): Promise<EstadoConsultado>;
  obtenerDocumento(documentoId: string): Promise<DocumentoApi>;
  descargarPdf(documentoId: string): Promise<{ contenido: Uint8Array; nombre: string }>;
  /** URL pública (sin credenciales) de un recurso del documento. */
  urlRecurso(documentoId: string, recurso: 'xml' | 'pdf'): string;
}

/** Cliente de la API REST de DTE/boletas (`/v1`) sobre `fetch`, con `Authorization: Bearer`. */
export class ClienteApiSii implements ApiDte {
  constructor(
    private readonly cfg: Config['api'],
    private readonly fetchImpl: typeof fetch = fetch,
  ) {}

  urlRecurso(documentoId: string, recurso: 'xml' | 'pdf'): string {
    return `${this.cfg.url}/v1/documentos/${documentoId}/${recurso}`;
  }

  private async pedir(
    metodo: string,
    ruta: string,
    o: { cuerpo?: unknown; headers?: Record<string, string> } = {},
  ): Promise<Response> {
    const headers: Record<string, string> = {
      Authorization: `Bearer ${this.cfg.apiKey}`,
      Accept: 'application/json',
      ...o.headers,
    };
    if (o.cuerpo !== undefined) headers['Content-Type'] = 'application/json';
    let res: Response;
    try {
      res = await this.fetchImpl(`${this.cfg.url}/v1${ruta}`, {
        method: metodo,
        headers,
        body: o.cuerpo === undefined ? undefined : JSON.stringify(o.cuerpo),
        signal: AbortSignal.timeout(this.cfg.timeoutMs),
      });
    } catch (e) {
      throw new ErrorRedApi(`${metodo} ${ruta.split('?')[0]}: ${(e as Error).message}`);
    }
    if (res.ok) return res;
    const texto = await res.text().catch(() => '');
    let p: { code?: string; title?: string; detail?: string; errors?: Array<{ campo?: string; mensaje: string }> } = {};
    try {
      p = JSON.parse(texto) as typeof p;
    } catch {
      /* cuerpo no JSON (proxy, 502 de balanceador) */
    }
    throw new ErrorApi(
      res.status,
      p.code ?? `HTTP_${res.status}`,
      p.title ?? res.statusText,
      p.detail ?? (texto.slice(0, 300) || res.statusText),
      p.errors ?? [],
    );
  }

  async emitir(rut: string, cuerpo: CuerpoDocumento, clave: string): Promise<ResultadoEmision> {
    const res = await this.pedir('POST', `/empresas/${encodeURIComponent(rut)}/documentos`, {
      cuerpo,
      headers: { 'Idempotency-Key': clave },
    });
    return {
      documento: (await res.json()) as DocumentoApi,
      repetido: res.headers.get('Idempotent-Replayed') === 'true',
    };
  }

  async crearEnvio(rut: string, documentoIds: string[]): Promise<EnvioApi[]> {
    const res = await this.pedir('POST', `/empresas/${encodeURIComponent(rut)}/envios`, {
      cuerpo: { documentoIds },
    });
    return ((await res.json()) as { envios: EnvioApi[] }).envios;
  }

  async consultarEstado(id: string): Promise<EstadoConsultado> {
    const res = await this.pedir('POST', `/documentos/${id}/consultar-estado`);
    return (await res.json()) as EstadoConsultado;
  }

  async obtenerDocumento(id: string): Promise<DocumentoApi> {
    return (await (await this.pedir('GET', `/documentos/${id}`)).json()) as DocumentoApi;
  }

  async descargarPdf(id: string): Promise<{ contenido: Uint8Array; nombre: string }> {
    const res = await this.pedir('GET', `/documentos/${id}/pdf`, { headers: { Accept: 'application/pdf' } });
    const disp = res.headers.get('Content-Disposition') ?? '';
    const nombre = /filename="?([^";]+)"?/.exec(disp)?.[1] ?? `DTE_${id}.pdf`;
    return { contenido: new Uint8Array(await res.arrayBuffer()), nombre };
  }
}
