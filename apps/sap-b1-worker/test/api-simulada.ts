import { createHash, randomUUID } from 'node:crypto';
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';

export interface DocSim {
  id: string;
  tipoDte: number;
  folio: number;
  estado: string;
  trackId: string | null;
  huella: string;
  clave: string;
  cuerpo: any;
  reparos: unknown;
  estadoSii: string | null;
  glosaSii: string | null;
}

export interface EmisionRecibida {
  clave: string | undefined;
  cuerpo: any;
  rut: string;
}

export interface RespuestaForzada {
  status: number;
  cuerpo?: unknown;
  /** Crea el documento y luego responde con el error (respuesta perdida en tránsito). */
  despuesDeCrear?: boolean;
}

/** API de DTE simulada con `node:http`: emisión idempotente, envíos, consulta de estado, XML/PDF. */
export class ApiSimulada {
  readonly documentos = new Map<string, DocSim>();
  readonly emisiones: EmisionRecibida[] = [];
  readonly envios: Array<{ documentoIds: string[] }> = [];
  readonly consultas: string[] = [];
  readonly autorizaciones: string[] = [];
  /** Respuestas forzadas para las próximas emisiones (se consumen en orden). */
  colaEmision: RespuestaForzada[] = [];
  /** Resultado de la consulta de estado por documento; por defecto `DOK` (aceptado). */
  resultadoEstado: (d: DocSim) => { estado: string; estadoSii: string; glosaSii: string; reparos?: unknown } = () => ({
    estado: 'aceptado',
    estadoSii: 'DOK',
    glosaSii: 'Documento recibido por el SII. Datos Coinciden.',
  });
  apiKey = 'sk_test_abc1234567_SECRETO-de-la-api-key-0123456789';

  url = '';
  private servidor: Server | null = null;
  private folios = new Map<number, number>();
  private track = 1000;

  async iniciar(): Promise<void> {
    this.servidor = createServer((req, res) => {
      this.atender(req, res).catch((e: unknown) => this.json(res, 500, { code: 'ERROR_INTERNO', title: 'Error', detail: String(e) }));
    });
    const srv = this.servidor;
    await new Promise<void>((ok) => srv.listen(0, '127.0.0.1', ok));
    this.url = `http://127.0.0.1:${(srv.address() as AddressInfo).port}`;
  }

  async detener(): Promise<void> {
    await new Promise<void>((ok) => (this.servidor ? this.servidor.close(() => ok()) : ok()));
    this.servidor?.closeAllConnections();
  }

  private json(res: ServerResponse, status: number, cuerpo: unknown, headers: Record<string, string> = {}): void {
    res.writeHead(status, {
      'Content-Type': status >= 400 ? 'application/problem+json' : 'application/json',
      ...headers,
    });
    res.end(JSON.stringify(cuerpo));
  }

  private problema(res: ServerResponse, status: number, code: string, detail: string, errors?: unknown[]): void {
    this.json(res, status, { code, title: code, detail, ...(errors ? { errors } : {}) });
  }

  private repr(d: DocSim) {
    return {
      id: d.id,
      empresa: '76086428-5',
      tipoDte: d.tipoDte,
      folio: d.folio,
      estado: d.estado,
      trackId: d.trackId,
      reparos: d.reparos ?? null,
      estadoSii: d.estadoSii,
      glosaSii: d.glosaSii,
      enlaces: { xml: `/v1/documentos/${d.id}/xml`, pdf: `/v1/documentos/${d.id}/pdf` },
    };
  }

  private crear(rut: string, clave: string, cuerpo: any, huella: string): DocSim {
    const tipo = cuerpo.idDoc.tipoDte as number;
    const folio = (this.folios.get(tipo) ?? 0) + 1;
    this.folios.set(tipo, folio);
    const d: DocSim = {
      id: randomUUID(),
      tipoDte: tipo,
      folio,
      estado: 'emitido',
      trackId: null,
      huella,
      clave,
      cuerpo,
      reparos: null,
      estadoSii: null,
      glosaSii: null,
    };
    this.documentos.set(d.id, d);
    return d;
  }

  private async atender(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const partes: Buffer[] = [];
    for await (const p of req) partes.push(p as Buffer);
    const texto = Buffer.concat(partes).toString('utf8');
    const url = new URL(req.url ?? '/', 'http://api');
    const metodo = req.method ?? 'GET';
    const auth = req.headers.authorization ?? '';
    this.autorizaciones.push(auth);
    if (auth !== `Bearer ${this.apiKey}`) {
      return this.problema(res, 401, 'NO_AUTENTICADO', 'Credencial inválida');
    }
    const cuerpo = texto ? JSON.parse(texto) : undefined;

    let m = /^\/v1\/empresas\/([^/]+)\/documentos$/.exec(url.pathname);
    if (m && metodo === 'POST') return this.emitir(req, res, decodeURIComponent(m[1] as string), cuerpo);

    m = /^\/v1\/empresas\/([^/]+)\/envios$/.exec(url.pathname);
    if (m && metodo === 'POST') return this.crearEnvio(res, cuerpo);

    m = /^\/v1\/documentos\/([^/]+)(?:\/(consultar-estado|pdf|xml))?$/.exec(url.pathname);
    if (m) {
      const d = this.documentos.get(m[1] as string);
      if (!d) return this.problema(res, 404, 'NO_ENCONTRADO', `Documento ${m[1]} no existe`);
      if (!m[2] && metodo === 'GET') return this.json(res, 200, this.repr(d));
      if (m[2] === 'pdf') {
        res.writeHead(200, {
          'Content-Type': 'application/pdf',
          'Content-Disposition': `inline; filename="DTE_${d.tipoDte}_${d.folio}.pdf"`,
        });
        return void res.end(Buffer.from('%PDF-1.4 simulado'));
      }
      if (m[2] === 'xml') {
        res.writeHead(200, { 'Content-Type': 'application/xml' });
        return void res.end('<DTE/>');
      }
      if (m[2] === 'consultar-estado' && metodo === 'POST') {
        this.consultas.push(d.id);
        if (d.estado === 'emitido' || d.estado === 'encolado') {
          return this.problema(res, 409, 'ESTADO_INVALIDO', `El documento ${d.tipoDte}-${d.folio} está ${d.estado}: solo se consulta el estado de documentos ya enviados al SII`);
        }
        const r = this.resultadoEstado(d);
        d.estado = r.estado;
        d.estadoSii = r.estadoSii;
        d.glosaSii = r.glosaSii;
        d.reparos = r.reparos ?? null;
        return this.json(res, 200, {
          documento: this.repr(d),
          estadoSii: r.estadoSii,
          glosaSii: r.glosaSii,
          esFinal: r.estado !== 'enviado',
          descripcionEstado: r.glosaSii,
        });
      }
    }
    return this.problema(res, 404, 'NO_ENCONTRADO', `Ruta ${metodo} ${url.pathname}`);
  }

  private emitir(req: IncomingMessage, res: ServerResponse, rut: string, cuerpo: any): void {
    const clave = req.headers['idempotency-key'] as string | undefined;
    this.emisiones.push({ clave, cuerpo, rut });
    const huella = createHash('sha256').update(JSON.stringify(cuerpo)).digest('hex');
    const forzada = this.colaEmision.shift();
    if (forzada && !forzada.despuesDeCrear) {
      return this.json(res, forzada.status, forzada.cuerpo ?? { code: 'ERROR', title: 'Error', detail: 'forzado' });
    }
    const previo = clave ? [...this.documentos.values()].find((d) => d.clave === clave) : undefined;
    if (previo && !forzada) {
      if (previo.huella !== huella) {
        return this.problema(res, 409, 'IDEMPOTENCIA_CONFLICTO', 'La Idempotency-Key ya se usó con un cuerpo distinto');
      }
      return this.json(res, 200, this.repr(previo), { 'Idempotent-Replayed': 'true' });
    }
    const d = previo ?? this.crear(rut, clave ?? randomUUID(), cuerpo, huella);
    if (forzada) {
      return this.json(res, forzada.status, forzada.cuerpo ?? { code: 'ERROR', title: 'Error', detail: 'respuesta perdida' });
    }
    this.json(res, 201, this.repr(d));
  }

  private crearEnvio(res: ServerResponse, cuerpo: { documentoIds?: string[] }): void {
    const ids = cuerpo.documentoIds ?? [];
    this.envios.push({ documentoIds: ids });
    const docs = ids.map((id) => this.documentos.get(id));
    if (docs.some((d) => !d)) return this.problema(res, 404, 'NO_ENCONTRADO', 'Documentos no encontrados');
    const lista = docs as DocSim[];
    const noEmitidos = lista.filter((d) => d.estado !== 'emitido');
    if (noEmitidos.length > 0) {
      return this.problema(res, 409, 'ESTADO_INVALIDO', `Solo se envían documentos en estado emitido; no lo están: ${noEmitidos.map((d) => `${d.tipoDte}-${d.folio} (${d.estado})`).join(', ')}`);
    }
    const boletas = lista.filter((d) => d.tipoDte === 39 || d.tipoDte === 41).length;
    if (boletas !== 0 && boletas !== lista.length) {
      return this.problema(res, 422, 'DOCUMENTO_INVALIDO', 'Las boletas (39/41) y los demás DTE viajan en sobres distintos');
    }
    const grupos: DocSim[][] = [];
    if (boletas > 0) for (let i = 0; i < lista.length; i += 50) grupos.push(lista.slice(i, i + 50));
    else grupos.push(lista);
    const envios = grupos.map((g) => {
      const trackId = String(++this.track);
      for (const d of g) {
        d.estado = 'enviado';
        d.trackId = trackId;
      }
      return {
        id: randomUUID(),
        canal: boletas > 0 ? 'boleta' : 'dte',
        trackId,
        estado: 'REC',
        documentos: g.map((d) => ({ documentoId: d.id, tipoDte: d.tipoDte, folio: d.folio })),
      };
    });
    this.json(res, 201, { envios });
  }
}
