import type { Config } from './config.js';
import type { Logger } from './log.js';

/** Error devuelto por Service Layer (formato `{ error: { code, message: { value } } }`). */
export class ErrorServiceLayer extends Error {
  constructor(
    readonly status: number,
    readonly codigo: string | number | undefined,
    mensaje: string,
  ) {
    super(mensaje);
    this.name = 'ErrorServiceLayer';
  }
}

/** Fallo de red o timeout hablando con Service Layer. */
export class ErrorRedServiceLayer extends Error {
  constructor(mensaje: string) {
    super(mensaje);
    this.name = 'ErrorRedServiceLayer';
  }
}

export interface OpcionesConsulta {
  filter?: string;
  select?: string[];
  orderby?: string;
  top?: number;
}

type SlConfig = Config['sl'];

interface Respuesta {
  status: number;
  texto: string;
  headers: Headers;
}

/** Construye `?$filter=...` codificando espacios como %20 (no `+`). */
export function construirQuery(o: OpcionesConsulta): string {
  const partes: string[] = [];
  if (o.filter) partes.push(`$filter=${encodeURIComponent(o.filter)}`);
  if (o.select?.length) partes.push(`$select=${encodeURIComponent(o.select.join(','))}`);
  if (o.orderby) partes.push(`$orderby=${encodeURIComponent(o.orderby)}`);
  if (o.top !== undefined) partes.push(`$top=${o.top}`);
  return partes.length ? `?${partes.join('&')}` : '';
}

/** Literal de texto OData (comillas simples duplicadas). */
export const literal = (v: string): string => `'${v.replace(/'/g, "''")}'`;

/**
 * Cliente mínimo de Service Layer sobre `fetch`: login con cookie de sesión (B1SESSION/ROUTEID),
 * reutilización de la sesión, una reautenticación ante 401 y paginación OData. Nunca registra
 * cookies, usuario ni contraseña.
 */
export class ClienteServiceLayer {
  private readonly cookies = new Map<string, string>();
  private login: Promise<void> | null = null;
  private conSesion = false;

  constructor(
    private readonly cfg: SlConfig,
    private readonly log: Logger,
    private readonly fetchImpl: typeof fetch = fetch,
  ) {}

  private get base(): string {
    return `${this.cfg.url}/b1s/${this.cfg.version}`;
  }

  /** Inicia sesión (idempotente: las llamadas simultáneas comparten el mismo login). */
  async autenticar(forzar = false): Promise<void> {
    if (this.conSesion && !forzar) return;
    this.login ??= this.hacerLogin().finally(() => {
      this.login = null;
    });
    await this.login;
  }

  private async hacerLogin(): Promise<void> {
    this.cookies.clear();
    this.conSesion = false;
    const r = await this.enviar('POST', `${this.base}/Login`, {
      cuerpo: JSON.stringify({
        CompanyDB: this.cfg.companyDb,
        UserName: this.cfg.usuario,
        Password: this.cfg.password,
      }),
    });
    if (r.status < 200 || r.status >= 300) throw this.aError(r);
    for (const c of r.headers.getSetCookie()) {
      const [par] = c.split(';');
      const i = par?.indexOf('=') ?? -1;
      if (par && i > 0) this.cookies.set(par.slice(0, i).trim(), par.slice(i + 1).trim());
    }
    if (!this.cookies.has('B1SESSION')) {
      // v2 también devuelve SessionId en el cuerpo; sin cookie no hay sesión utilizable.
      try {
        const sid = (JSON.parse(r.texto) as { SessionId?: string }).SessionId;
        if (sid) this.cookies.set('B1SESSION', sid);
      } catch {
        /* sin cuerpo JSON */
      }
    }
    this.conSesion = true;
    this.log.info('sesion de Service Layer iniciada', { companyDb: this.cfg.companyDb });
  }

  async cerrarSesion(): Promise<void> {
    if (!this.conSesion) return;
    try {
      await this.enviar('POST', `${this.base}/Logout`, {});
    } catch (e) {
      this.log.warn('no se pudo cerrar la sesion de Service Layer', { error: (e as Error).message });
    } finally {
      this.conSesion = false;
      this.cookies.clear();
    }
  }

  private async enviar(
    metodo: string,
    url: string,
    o: { cuerpo?: NonNullable<RequestInit['body']>; headers?: Record<string, string> },
  ): Promise<Respuesta> {
    const headers: Record<string, string> = { Accept: 'application/json', ...o.headers };
    if (typeof o.cuerpo === 'string') headers['Content-Type'] = 'application/json';
    if (this.cookies.size > 0) {
      headers['Cookie'] = [...this.cookies].map(([k, v]) => `${k}=${v}`).join('; ');
    }
    try {
      const res = await this.fetchImpl(url, {
        method: metodo,
        headers,
        body: o.cuerpo,
        signal: AbortSignal.timeout(this.cfg.timeoutMs),
      });
      return { status: res.status, texto: await res.text(), headers: res.headers };
    } catch (e) {
      throw new ErrorRedServiceLayer(`${metodo} ${rutaSegura(url)}: ${(e as Error).message}`);
    }
  }

  private aError(r: Respuesta): ErrorServiceLayer {
    let codigo: string | number | undefined;
    let mensaje = r.texto.slice(0, 300) || `HTTP ${r.status}`;
    try {
      const e = (JSON.parse(r.texto) as { error?: { code?: string | number; message?: { value?: string } | string } }).error;
      if (e) {
        codigo = e.code;
        const m = typeof e.message === 'string' ? e.message : e.message?.value;
        if (m) mensaje = m;
      }
    } catch {
      /* cuerpo no JSON */
    }
    return new ErrorServiceLayer(r.status, codigo, mensaje);
  }

  /** Petición con sesión; ante 401 reautentica una vez y repite. Devuelve el JSON (o null si 204). */
  async solicitar<T = unknown>(
    metodo: string,
    ruta: string,
    o: { cuerpo?: unknown; formulario?: FormData; headers?: Record<string, string> } = {},
  ): Promise<T | null> {
    const url = /^https?:\/\//.test(ruta) ? ruta : `${this.base}/${ruta.replace(/^\/+/, '')}`;
    const cuerpo: NonNullable<RequestInit['body']> | undefined =
      o.formulario ?? (o.cuerpo === undefined ? undefined : JSON.stringify(o.cuerpo));
    await this.autenticar();
    let r = await this.enviar(metodo, url, { cuerpo, headers: o.headers });
    if (r.status === 401) {
      this.log.warn('Service Layer respondio 401: se reautentica una vez');
      await this.autenticar(true);
      r = await this.enviar(metodo, url, { cuerpo, headers: o.headers });
    }
    if (r.status < 200 || r.status >= 300) throw this.aError(r);
    if (r.status === 204 || r.texto.length === 0) return null;
    return JSON.parse(r.texto) as T;
  }

  /** Lee una colección completa siguiendo `odata.nextLink` / `@odata.nextLink`. */
  async listar<T>(entidad: string, o: OpcionesConsulta = {}): Promise<T[]> {
    const salida: T[] = [];
    let ruta: string | null = `${entidad}${construirQuery(o)}`;
    let paginas = 0;
    while (ruta !== null) {
      const pagina: Pagina<T> | null = await this.solicitar<Pagina<T>>('GET', ruta, {
        headers: { Prefer: `odata.maxpagesize=${this.cfg.paginaMax}` },
      });
      salida.push(...(pagina?.value ?? []));
      const siguiente: string | undefined = pagina?.['odata.nextLink'] ?? pagina?.['@odata.nextLink'];
      ruta = siguiente ? this.resolverNextLink(siguiente) : null;
      if (++paginas > 10_000) throw new Error(`Paginacion sin fin en ${entidad}`);
      if (o.top !== undefined && salida.length >= o.top) break;
    }
    return o.top !== undefined ? salida.slice(0, o.top) : salida;
  }

  /** `nextLink` puede ser relativo a `/b1s/vN/` o absoluto; se normaliza a una URL completa. */
  private resolverNextLink(link: string): string {
    if (/^https?:\/\//.test(link)) return link;
    if (link.startsWith('/')) return `${this.cfg.url}${link}`;
    return `${this.base}/${link}`;
  }

  obtener<T>(entidad: string, clave: string | number, select?: string[]): Promise<T | null> {
    const k = typeof clave === 'number' ? String(clave) : literal(clave);
    return this.solicitar<T>('GET', `${entidad}(${k})${construirQuery({ select })}`);
  }

  async modificar(entidad: string, clave: string | number, cambios: Record<string, unknown>): Promise<void> {
    const k = typeof clave === 'number' ? String(clave) : literal(clave);
    await this.solicitar('PATCH', `${entidad}(${k})`, { cuerpo: cambios });
  }

  async crear<T = unknown>(entidad: string, cuerpo: unknown): Promise<T | null> {
    return this.solicitar<T>('POST', entidad, { cuerpo });
  }

  /** Sube un archivo a `Attachments2` y devuelve su `AbsoluteEntry`. */
  async subirAdjunto(nombre: string, contenido: Uint8Array, mime: string): Promise<number> {
    const form = new FormData();
    form.append('files', new Blob([contenido], { type: mime }), nombre);
    const r = await this.solicitar<{ AbsoluteEntry?: number }>('POST', 'Attachments2', { formulario: form });
    const entrada = r?.AbsoluteEntry;
    if (typeof entrada !== 'number') throw new Error('Attachments2 no devolvio AbsoluteEntry');
    return entrada;
  }
}

interface Pagina<T> {
  value?: T[];
  'odata.nextLink'?: string;
  '@odata.nextLink'?: string;
}

/** Ruta sin query para mensajes de error (el filtro puede contener datos). */
function rutaSegura(url: string): string {
  try {
    return new URL(url).pathname;
  } catch {
    return 'url';
  }
}
