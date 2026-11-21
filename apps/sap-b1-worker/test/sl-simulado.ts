import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';

type Fila = Record<string, unknown>;

export interface PeticionSl {
  metodo: string;
  ruta: string;
  query: string;
}

/**
 * Service Layer simulado en memoria con `node:http`: Login con cookie, 401 por sesión expirada,
 * `$filter` por `U_SII_Estado`, `$select`, paginación (`odata.nextLink`), GET/PATCH por clave,
 * UserFieldsMD y Attachments2.
 */
export class ServiceLayerSimulado {
  readonly entidades = new Map<string, Map<number, Fila>>([
    ['Invoices', new Map()],
    ['CreditNotes', new Map()],
    ['DeliveryNotes', new Map()],
  ]);
  readonly socios = new Map<string, Fila>();
  readonly udfs = new Map<string, Fila>();
  readonly adjuntos: Array<{ id: number; nombre: string; bytes: number }> = [];
  readonly peticiones: PeticionSl[] = [];
  readonly cookiesRecibidas: string[] = [];
  logins = 0;
  logouts = 0;
  /** Si devuelve true, la petición responde 500 (fallo transitorio inyectado). */
  fallar: ((p: PeticionSl) => boolean) | null = null;
  versionApi = 'v2';
  credenciales = { companyDb: 'SBO_DEMO', usuario: 'manager', password: 'clave-sl-secreta' };

  private sesiones = new Set<string>();
  private servidor: Server | null = null;
  private contadorSesion = 0;
  private contadorAdjunto = 0;

  url = '';

  async iniciar(): Promise<void> {
    this.servidor = createServer((req, res) => {
      this.atender(req, res).catch((e: unknown) => {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: { code: -1, message: { value: String(e) } } }));
      });
    });
    const srv = this.servidor;
    await new Promise<void>((ok) => srv.listen(0, '127.0.0.1', ok));
    this.url = `http://127.0.0.1:${(srv.address() as AddressInfo).port}`;
  }

  async detener(): Promise<void> {
    await new Promise<void>((ok) => (this.servidor ? this.servidor.close(() => ok()) : ok()));
    this.servidor?.closeAllConnections();
  }

  /** Invalida todas las sesiones: la próxima petición recibe 401. */
  expirarSesiones(): void {
    this.sesiones.clear();
  }

  agregarDoc(entidad: string, doc: Fila): void {
    this.entidades.get(entidad)?.set(doc['DocEntry'] as number, doc);
  }

  doc(entidad: string, docEntry: number): Fila {
    return this.entidades.get(entidad)?.get(docEntry) as Fila;
  }

  private responder(res: ServerResponse, status: number, cuerpo?: unknown, headers: Record<string, string | string[]> = {}): void {
    res.writeHead(status, { 'Content-Type': 'application/json', ...headers });
    res.end(cuerpo === undefined ? undefined : JSON.stringify(cuerpo));
  }

  private error(res: ServerResponse, status: number, code: number, mensaje: string): void {
    this.responder(res, status, { error: { code, message: { lang: 'en-us', value: mensaje } } });
  }

  private async leer(req: IncomingMessage): Promise<Buffer> {
    const partes: Buffer[] = [];
    for await (const p of req) partes.push(p as Buffer);
    return Buffer.concat(partes);
  }

  private async atender(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const url = new URL(req.url ?? '/', 'http://sl');
    const prefijo = `/b1s/${this.versionApi}/`;
    if (!url.pathname.startsWith(prefijo)) return this.error(res, 404, -1, 'Ruta desconocida');
    const ruta = decodeURIComponent(url.pathname.slice(prefijo.length));
    const metodo = req.method ?? 'GET';
    const cuerpoCrudo = await this.leer(req);

    if (ruta === 'Login' && metodo === 'POST') {
      const b = JSON.parse(cuerpoCrudo.toString('utf8')) as Record<string, string>;
      if (
        b['CompanyDB'] !== this.credenciales.companyDb ||
        b['UserName'] !== this.credenciales.usuario ||
        b['Password'] !== this.credenciales.password
      ) {
        return this.error(res, 401, -304, 'Fail to get DB Credentials from DB Server');
      }
      this.logins++;
      const sid = `sesion-${++this.contadorSesion}`;
      this.sesiones.add(sid);
      return this.responder(res, 200, { SessionId: sid, Version: '1000150', SessionTimeout: 30 }, {
        'Set-Cookie': [`B1SESSION=${sid}; path=/; HttpOnly;`, 'ROUTEID=.node0; path=/b1s'],
      });
    }

    const cookie = req.headers.cookie ?? '';
    this.cookiesRecibidas.push(cookie);
    const sid = /B1SESSION=([^;]+)/.exec(cookie)?.[1];
    if (!sid || !this.sesiones.has(sid)) return this.error(res, 401, -1, 'Invalid session or session already timeout.');

    const peticion: PeticionSl = { metodo, ruta, query: url.search };
    this.peticiones.push(peticion);
    if (this.fallar?.(peticion)) return this.error(res, 500, -2, 'Fallo transitorio inyectado');

    if (ruta === 'Logout') {
      this.logouts++;
      this.sesiones.delete(sid);
      return this.responder(res, 204);
    }

    if (ruta === 'UserFieldsMD') {
      if (metodo === 'GET') {
        const f = url.searchParams.get('$filter') ?? '';
        const tabla = /TableName eq '([^']+)'/.exec(f)?.[1];
        const nombre = /Name eq '([^']+)'/.exec(f)?.[1];
        const valor = tabla && nombre && this.udfs.has(`${tabla}.${nombre}`) ? [{ FieldID: 1 }] : [];
        return this.responder(res, 200, { value: valor });
      }
      const b = JSON.parse(cuerpoCrudo.toString('utf8')) as Fila;
      const k = `${String(b['TableName'])}.${String(b['Name'])}`;
      if (this.udfs.has(k)) return this.error(res, 400, -2035, 'Field already exists');
      this.udfs.set(k, b);
      return this.responder(res, 201, b);
    }

    if (ruta === 'Attachments2' && metodo === 'POST') {
      const nombre = /filename="([^"]+)"/.exec(cuerpoCrudo.toString('latin1'))?.[1] ?? 'archivo';
      const id = ++this.contadorAdjunto;
      this.adjuntos.push({ id, nombre, bytes: cuerpoCrudo.length });
      return this.responder(res, 201, { AbsoluteEntry: id });
    }

    const m = /^(\w+)(?:\(('?)([^')]+)'?\))?$/.exec(ruta);
    if (!m) return this.error(res, 404, -1, 'Ruta desconocida');
    const [, entidad, comilla, clave] = m;

    if (entidad === 'BusinessPartners' && clave) {
      const s = this.socios.get(clave);
      return s ? this.responder(res, 200, s) : this.error(res, 404, -2028, 'No matching records found');
    }

    const coleccion = this.entidades.get(entidad as string);
    if (!coleccion) return this.error(res, 404, -1, 'Entidad desconocida');

    if (clave && comilla === '') {
      const doc = coleccion.get(Number(clave));
      if (!doc) return this.error(res, 404, -2028, 'No matching records found');
      if (metodo === 'GET') return this.responder(res, 200, this.proyectar(doc, url.searchParams.get('$select')));
      if (metodo === 'PATCH') {
        const cambios = JSON.parse(cuerpoCrudo.toString('utf8')) as Fila;
        Object.assign(doc, cambios);
        return this.responder(res, 204);
      }
    }

    if (!clave && metodo === 'GET') {
      const filtro = decodeURIComponent(url.searchParams.get('$filter') ?? '');
      const estado = /U_SII_Estado eq '([^']+)'/.exec(filtro)?.[1];
      const todos = [...coleccion.values()]
        .filter((d) => estado === undefined || d['U_SII_Estado'] === estado)
        .sort((a, b) => (a['DocEntry'] as number) - (b['DocEntry'] as number));
      const pagina = Number(/odata\.maxpagesize=(\d+)/.exec(String(req.headers['prefer'] ?? ''))?.[1] ?? 20);
      const salto = Number(url.searchParams.get('$skip') ?? 0);
      const trozo = todos.slice(salto, salto + pagina);
      const cuerpo: Fila = { value: trozo.map((d) => this.proyectar(d, url.searchParams.get('$select'))) };
      if (salto + pagina < todos.length) {
        const sig = new URLSearchParams(url.search);
        sig.set('$skip', String(salto + pagina));
        const clave2 = this.versionApi === 'v1' ? 'odata.nextLink' : 'odata.nextLink';
        // Relativo a /b1s/vN/, como lo hace Service Layer.
        cuerpo[clave2] = `${entidad}?${sig.toString().replace(/\+/g, '%20')}`;
      }
      return this.responder(res, 200, cuerpo);
    }
    return this.error(res, 405, -1, 'Metodo no soportado');
  }

  private proyectar(doc: Fila, select: string | null): Fila {
    if (!select) return doc;
    const salida: Fila = {};
    for (const campo of select.split(',')) salida[campo] = doc[campo] ?? null;
    return salida;
  }
}
