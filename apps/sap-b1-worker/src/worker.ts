import { type ApiDte, type DocumentoApi, ErrorApi, esErrorDefinitivo } from './api-sii.js';
import type { Config } from './config.js';
import type { Logger } from './log.js';
import { basesDe, claveBase, mapearDocumento } from './mapeador.js';
import type { ClienteServiceLayer } from './service-layer.js';
import {
  type BaseInfo,
  type DocumentoB1,
  type EntidadB1,
  ENTIDADES,
  entidadPorObjType,
  type EstadoSii,
  type SocioB1,
} from './tipos-b1.js';

const MAX_GLOSA = 2000;
const MAX_BOLETAS_POR_ENVIO = 500;
const MAX_DTE_POR_ENVIO = 200;

export interface ResumenCiclo {
  emitidos: number;
  errores: number;
  reintentos: number;
  enviados: number;
  seguidos: number;
}

interface ItemDoc {
  ent: EntidadB1;
  docEntry: number;
  docId?: string;
  tipo?: number;
}

export const acotar = (s: string, max = MAX_GLOSA): string => (s.length > max ? `${s.slice(0, max - 3)}...` : s);
const clave = (ent: EntidadB1, docEntry: number): string => `${ent.objType}:${docEntry}`;

/** `Idempotency-Key` de un documento B1: determinista por empresa + tipo de objeto + DocEntry. */
export const claveIdempotencia = (rutEmpresa: string, ent: EntidadB1, docEntry: number): string =>
  `b1:${rutEmpresa}:${ent.objType}:${docEntry}`;

/** Ejecuta `fn` sobre los elementos con a lo más `n` en paralelo; un fallo no detiene al resto. */
async function enParalelo<T>(items: T[], n: number, fn: (item: T) => Promise<void>): Promise<void> {
  const cola = [...items];
  const trabajador = async (): Promise<void> => {
    for (let item = cola.shift(); item !== undefined; item = cola.shift()) await fn(item);
  };
  await Promise.all(Array.from({ length: Math.min(n, items.length) }, trabajador));
}

function trozos<T>(lista: T[], tamano: number): T[][] {
  const r: T[][] = [];
  for (let i = 0; i < lista.length; i += tamano) r.push(lista.slice(i, i + tamano));
  return r;
}

/** Estado de B1 que corresponde al estado de emisión de la API. */
export function estadoB1Desde(estadoApi: string): EstadoSii | null {
  switch (estadoApi) {
    case 'emitido':
    case 'encolado':
      return 'EMITIDO';
    case 'enviado':
      return 'ENVIADO';
    case 'aceptado':
      return 'ACEPTADO';
    case 'aceptado_con_reparos':
      return 'REPAROS';
    case 'rechazado':
    case 'anulado':
      return 'RECHAZADO';
    default:
      return null;
  }
}

function glosaDeEstado(d: DocumentoApi, extra: { glosaSii?: string | null; descripcion?: string; estadoSii?: string | null }): string {
  const partes: string[] = [];
  if (d.estado === 'anulado') partes.push('Anulado en el SII');
  const base = extra.glosaSii ?? extra.descripcion ?? '';
  if (extra.estadoSii || base) partes.push([extra.estadoSii, base].filter(Boolean).join(': '));
  if (d.reparos !== null && d.reparos !== undefined && d.reparos !== '') {
    partes.push(`Reparos: ${typeof d.reparos === 'string' ? d.reparos : JSON.stringify(d.reparos)}`);
  }
  return acotar(partes.join('\n'));
}

export class Worker {
  private readonly reintentos = new Map<string, { intentos: number; proximo: number }>();
  private readonly ultimaConsulta = new Map<string, number>();
  private enCurso = false;
  private detenido = false;
  private despertar: (() => void) | null = null;
  private ultimaConciliacion = 0;

  constructor(
    private readonly cfg: Config,
    private readonly sl: ClienteServiceLayer,
    private readonly api: ApiDte,
    private readonly log: Logger,
    private readonly ahora: () => number = Date.now,
  ) {}

  // ---------------------------------------------------------------- ciclo continuo

  /** Ciclo continuo hasta `detener()`: concilia al arrancar y luego cada `conciliacionMinutos`. */
  async ejecutar(): Promise<void> {
    this.log.info('worker iniciado', {
      empresa: this.cfg.api.rutEmpresa,
      intervaloSegundos: this.cfg.intervaloSegundos,
      enviarAutomaticamente: this.cfg.enviarAutomaticamente,
    });
    try {
      while (!this.detenido) {
        const toca = this.ahora() - this.ultimaConciliacion >= this.cfg.conciliacionMinutos * 60_000;
        try {
          await this.ciclo({ conciliar: toca });
        } catch (e) {
          this.log.error('ciclo fallido', { error: (e as Error).message });
        }
        if (this.detenido) break;
        await this.dormir(this.cfg.intervaloSegundos * 1000);
      }
    } finally {
      await this.sl.cerrarSesion();
      this.log.info('worker detenido');
    }
  }

  /** Pide el cierre ordenado: termina el ciclo en curso y no inicia otro. */
  detener(): void {
    this.detenido = true;
    this.despertar?.();
  }

  private dormir(ms: number): Promise<void> {
    return new Promise((resolver) => {
      const t = setTimeout(() => {
        this.despertar = null;
        resolver();
      }, ms);
      this.despertar = () => {
        clearTimeout(t);
        this.despertar = null;
        resolver();
      };
    });
  }

  /**
   * Un ciclo: emisión (pendientes y reintentos), envío al SII y seguimiento. Con `conciliar` se
   * reintentan además todos los documentos `ENVIANDO`, sin esperar el backoff. Devuelve `null` si
   * ya hay un ciclo en curso (no se solapan).
   */
  async ciclo(opciones: { conciliar?: boolean } = {}): Promise<ResumenCiclo | null> {
    if (this.enCurso) {
      this.log.warn('ciclo omitido: el anterior sigue en curso');
      return null;
    }
    this.enCurso = true;
    const r: ResumenCiclo = { emitidos: 0, errores: 0, reintentos: 0, enviados: 0, seguidos: 0 };
    try {
      if (opciones.conciliar) this.ultimaConciliacion = this.ahora();
      await this.fase('emision', () => this.faseEmision(opciones.conciliar === true, r));
      if (this.cfg.enviarAutomaticamente) await this.fase('envio', () => this.faseEnvio(r));
      await this.fase('seguimiento', () => this.faseSeguimiento(r));
      this.log.info('ciclo completo', { ...r, conciliacion: opciones.conciliar === true });
      return r;
    } finally {
      this.enCurso = false;
    }
  }

  private async fase(nombre: string, fn: () => Promise<void>): Promise<void> {
    try {
      await fn();
    } catch (e) {
      this.log.error(`fase ${nombre} fallida`, { error: (e as Error).message });
    }
  }

  // ---------------------------------------------------------------- utilidades B1

  private async porEstado(ent: EntidadB1, estado: EstadoSii): Promise<ItemDoc[]> {
    const filas = await this.sl.listar<Pick<DocumentoB1, 'DocEntry' | 'U_SII_DocId' | 'U_SII_TipoDTE'>>(ent.entidad, {
      filter: `U_SII_Estado eq '${estado}'`,
      select: ['DocEntry', 'U_SII_DocId', 'U_SII_TipoDTE'],
      orderby: 'DocEntry',
    });
    return filas.map((f) => ({
      ent,
      docEntry: f.DocEntry,
      docId: f.U_SII_DocId?.trim() || undefined,
      tipo: f.U_SII_TipoDTE ? Number(f.U_SII_TipoDTE) : undefined,
    }));
  }

  private parchar(item: ItemDoc, cambios: Record<string, unknown>): Promise<void> {
    return this.sl.modificar(item.ent.entidad, item.docEntry, cambios);
  }

  private registrarReintento(k: string): { intentos: number; esperaMs: number } {
    const intentos = (this.reintentos.get(k)?.intentos ?? 0) + 1;
    const esperaMs = Math.min(this.cfg.backoffBaseMs * 2 ** (intentos - 1), this.cfg.backoffMaxMs);
    this.reintentos.set(k, { intentos, proximo: this.ahora() + esperaMs });
    return { intentos, esperaMs };
  }

  // ---------------------------------------------------------------- a) emisión

  private async faseEmision(conciliar: boolean, r: ResumenCiclo): Promise<void> {
    const items: ItemDoc[] = [];
    for (const ent of ENTIDADES) {
      items.push(...(await this.porEstado(ent, 'PENDIENTE')));
      for (const it of await this.porEstado(ent, 'ENVIANDO')) {
        const reint = this.reintentos.get(clave(ent, it.docEntry));
        if (conciliar || (reint && reint.proximo <= this.ahora())) items.push(it);
      }
    }
    await enParalelo(items, this.cfg.concurrencia, async (item) => {
      const k = clave(item.ent, item.docEntry);
      try {
        const res = await this.emitirDocumento(item);
        if (res === 'emitido') r.emitidos++;
        else if (res === 'error') r.errores++;
      } catch (e) {
        r.reintentos++;
        const { intentos, esperaMs } = this.registrarReintento(k);
        this.log.warn('emision fallida, queda ENVIANDO y se reintenta con la misma clave', {
          objType: item.ent.objType,
          docEntry: item.docEntry,
          intentos,
          proximoEnMs: esperaMs,
          error: (e as Error).message,
        });
      }
    });
  }

  /**
   * Emite un documento B1. Devuelve `emitido`, `error` (U_SII_Estado = ERROR, sin reintento) u
   * `omitido`. Lanza ante fallos transitorios (red, 5xx, sesión): el documento queda `ENVIANDO`.
   */
  private async emitirDocumento(item: ItemDoc): Promise<'emitido' | 'error' | 'omitido'> {
    const { ent, docEntry } = item;
    const doc = await this.sl.obtener<DocumentoB1>(ent.entidad, docEntry);
    if (!doc) return 'omitido';
    const estado = doc.U_SII_Estado;
    if (estado !== 'PENDIENTE' && estado !== 'ENVIANDO') return 'omitido';
    const k = clave(ent, docEntry);
    const idem = doc.U_SII_IdemKey?.trim() || claveIdempotencia(this.cfg.api.rutEmpresa, ent, docEntry);
    const ctxLog = { objType: ent.objType, docEntry, idemKey: idem };

    if (estado === 'PENDIENTE') {
      await this.parchar(item, { U_SII_Estado: 'ENVIANDO', U_SII_IdemKey: idem, U_SII_Glosa: '' });
    }

    const socio = await this.leerSocio(doc.CardCode);
    const bases = new Map<string, BaseInfo>();
    if (ent.objType === 14 || doc.U_SII_TipoDTE?.trim() === '56') {
      for (const b of basesDe(doc)) {
        const entBase = entidadPorObjType(b.objType);
        if (!entBase) continue;
        const base = await this.sl.obtener<DocumentoB1>(entBase.entidad, b.docEntry, [
          'DocEntry',
          'DocDate',
          'U_SII_Folio',
          'U_SII_TipoDTE',
        ]);
        if (base) {
          bases.set(claveBase(b.objType, b.docEntry), {
            objType: b.objType,
            docEntry: b.docEntry,
            docDate: base.DocDate,
            folio: base.U_SII_Folio ?? null,
            tipoDte: base.U_SII_TipoDTE ? Number(base.U_SII_TipoDTE) : null,
          });
        }
      }
    }

    const mapeo = mapearDocumento(ent, doc, { config: this.cfg.b1, socio, bases });
    if (!mapeo.ok) {
      await this.parchar(item, { U_SII_Estado: 'ERROR', U_SII_Glosa: acotar(mapeo.errores.join('\n')) });
      this.reintentos.delete(k);
      this.log.warn('documento con errores de validacion', { ...ctxLog, errores: mapeo.errores });
      return 'error';
    }
    for (const a of mapeo.advertencias) this.log.warn('advertencia de mapeo', { ...ctxLog, advertencia: a });

    let emision;
    try {
      emision = await this.api.emitir(this.cfg.api.rutEmpresa, mapeo.cuerpo, idem);
    } catch (e) {
      if (esErrorDefinitivo(e)) {
        await this.parchar(item, { U_SII_Estado: 'ERROR', U_SII_Glosa: acotar(e.glosa()) });
        this.reintentos.delete(k);
        this.log.warn('la API rechazo el documento', { ...ctxLog, status: e.status, codigo: e.codigo });
        return 'error';
      }
      throw e;
    }

    const d = emision.documento;
    await this.parchar(item, {
      U_SII_Estado: 'EMITIDO',
      U_SII_TipoDTE: String(mapeo.tipoDte),
      U_SII_Folio: d.folio,
      U_SII_DocId: d.id,
      U_SII_XmlUrl: this.api.urlRecurso(d.id, 'xml'),
      U_SII_PdfUrl: this.api.urlRecurso(d.id, 'pdf'),
      U_SII_IdemKey: idem,
      U_SII_Glosa: '',
    });
    this.reintentos.delete(k);
    this.log.info('documento emitido', {
      ...ctxLog,
      tipoDte: mapeo.tipoDte,
      folio: d.folio,
      docId: d.id,
      repetido: emision.repetido,
    });

    await this.adjuntarPdf(item, doc, d);
    return 'emitido';
  }

  private async leerSocio(cardCode: string): Promise<SocioB1 | null> {
    try {
      return await this.sl.obtener<SocioB1>('BusinessPartners', cardCode);
    } catch (e) {
      // 404 = el socio no existe (error de datos); cualquier otra falla es transitoria.
      if ((e as { status?: number }).status === 404) return null;
      throw e;
    }
  }

  /** Adjunta el PDF al documento (`Attachments2` + `AttachmentEntry`); si falla solo queda la URL. */
  private async adjuntarPdf(item: ItemDoc, doc: DocumentoB1, d: DocumentoApi): Promise<void> {
    if (doc.AttachmentEntry) {
      this.log.info('el documento ya tiene adjuntos: se omite el PDF (queda U_SII_PdfUrl)', { docEntry: item.docEntry });
      return;
    }
    try {
      const pdf = await this.api.descargarPdf(d.id);
      const entrada = await this.sl.subirAdjunto(pdf.nombre, pdf.contenido, 'application/pdf');
      await this.parchar(item, { AttachmentEntry: entrada });
    } catch (e) {
      this.log.warn('no se pudo adjuntar el PDF (no bloquea; queda la URL)', {
        objType: item.ent.objType,
        docEntry: item.docEntry,
        error: (e as Error).message,
      });
    }
  }

  // ---------------------------------------------------------------- b) envío al SII

  private async faseEnvio(r: ResumenCiclo): Promise<void> {
    const emitidos: ItemDoc[] = [];
    for (const ent of ENTIDADES) emitidos.push(...(await this.porEstado(ent, 'EMITIDO')));
    const conId = emitidos.filter((i) => {
      if (!i.docId) this.log.warn('documento EMITIDO sin U_SII_DocId: no se puede enviar', { docEntry: i.docEntry });
      return i.docId;
    });
    // Boletas y DTE viajan en sobres distintos.
    const boletas = conId.filter((i) => i.tipo === 39 || i.tipo === 41);
    const dte = conId.filter((i) => i.tipo !== 39 && i.tipo !== 41);
    const lotes = [...trozos(boletas, MAX_BOLETAS_POR_ENVIO), ...trozos(dte, MAX_DTE_POR_ENVIO)];
    for (const lote of lotes) await this.enviarLote(lote, r);
  }

  private async enviarLote(lote: ItemDoc[], r: ResumenCiclo): Promise<void> {
    const porDocId = new Map(lote.map((i) => [i.docId as string, i] as const));
    try {
      const envios = await this.api.crearEnvio(
        this.cfg.api.rutEmpresa,
        lote.map((i) => i.docId as string),
      );
      for (const envio of envios) {
        for (const dEnvio of envio.documentos) {
          const item = porDocId.get(dEnvio.documentoId);
          if (!item) continue;
          await this.parchar(item, {
            U_SII_Estado: 'ENVIADO',
            U_SII_TrackId: envio.trackId ?? '',
            U_SII_Glosa: '',
          });
          r.enviados++;
          this.log.info('documento enviado al SII', {
            objType: item.ent.objType,
            docEntry: item.docEntry,
            trackId: envio.trackId,
          });
        }
      }
    } catch (e) {
      if (e instanceof ErrorApi && e.status === 409 && lote.length > 1) {
        // Algún documento ya no está `emitido` en la API: se separa para no bloquear al resto.
        for (const item of lote) await this.enviarLote([item], r);
        return;
      }
      if (e instanceof ErrorApi && e.status === 409 && lote.length === 1) {
        await this.sincronizarDesdeApi(lote[0] as ItemDoc, r);
        return;
      }
      this.log.warn('envio al SII fallido; se reintenta en el proximo ciclo', {
        documentos: lote.length,
        error: (e as Error).message,
      });
    }
  }

  /** El documento ya salió en otro envío: refleja en B1 el estado que tiene en la API. */
  private async sincronizarDesdeApi(item: ItemDoc, r: ResumenCiclo): Promise<void> {
    try {
      const d = await this.api.obtenerDocumento(item.docId as string);
      const nuevo = estadoB1Desde(d.estado);
      if (!nuevo || nuevo === 'EMITIDO') return;
      await this.parchar(item, {
        U_SII_Estado: nuevo,
        ...(d.trackId ? { U_SII_TrackId: d.trackId } : {}),
        U_SII_Glosa: nuevo === 'ENVIADO' ? '' : glosaDeEstado(d, { glosaSii: d.glosaSii, estadoSii: d.estadoSii }),
      });
      if (nuevo === 'ENVIADO') r.enviados++;
    } catch (e) {
      this.log.warn('no se pudo sincronizar el documento con la API', {
        docEntry: item.docEntry,
        error: (e as Error).message,
      });
    }
  }

  // ---------------------------------------------------------------- c) seguimiento

  private async faseSeguimiento(r: ResumenCiclo): Promise<void> {
    const items: ItemDoc[] = [];
    const ahora = this.ahora();
    for (const ent of ENTIDADES) {
      for (const it of await this.porEstado(ent, 'ENVIADO')) {
        const ultima = this.ultimaConsulta.get(clave(ent, it.docEntry));
        if (it.docId && (ultima === undefined || ahora - ultima >= this.cfg.seguimientoMinSegundos * 1000)) {
          items.push(it);
        }
      }
    }
    await enParalelo(items, this.cfg.concurrencia, async (item) => {
      const k = clave(item.ent, item.docEntry);
      try {
        const e = await this.api.consultarEstado(item.docId as string);
        r.seguidos++;
        const nuevo = estadoB1Desde(e.documento.estado);
        if (!nuevo || nuevo === 'ENVIADO') {
          this.ultimaConsulta.set(k, this.ahora());
          return;
        }
        this.ultimaConsulta.delete(k);
        await this.parchar(item, {
          U_SII_Estado: nuevo,
          ...(e.documento.trackId ? { U_SII_TrackId: e.documento.trackId } : {}),
          U_SII_Glosa:
            nuevo === 'EMITIDO'
              ? 'El SII aun no recibe el documento: se reenviara'
              : glosaDeEstado(e.documento, { glosaSii: e.glosaSii, descripcion: e.descripcionEstado, estadoSii: e.estadoSii }),
        });
        this.log.info('estado actualizado desde el SII', {
          objType: item.ent.objType,
          docEntry: item.docEntry,
          estado: nuevo,
          estadoSii: e.estadoSii,
        });
      } catch (e) {
        this.ultimaConsulta.set(k, this.ahora());
        if (e instanceof ErrorApi && e.status === 409) {
          // La API no tiene el documento como enviado: vuelve a EMITIDO para reenviarlo.
          await this.parchar(item, { U_SII_Estado: 'EMITIDO', U_SII_Glosa: acotar(e.glosa()) }).catch(() => undefined);
          return;
        }
        this.log.warn('no se pudo consultar el estado', {
          objType: item.ent.objType,
          docEntry: item.docEntry,
          error: (e as Error).message,
        });
      }
    });
  }
}
