import type { EstadoDocumento } from '../documentos/entities/documento.entity.js';

/** Estados de envío del SII que rechazan todo el sobre. */
export const ESTADOS_ENVIO_RECHAZADO: ReadonlySet<string> = new Set([
  'RCH',
  'RCO',
  'RFR',
  'RSC',
  'RCT',
  'RPT',
  'VOF',
]);

export interface DocumentoEnSobre {
  documentoId: string;
  tipoDte: number;
  folio: number;
}

/** Detalle por documento que informa la API de boletas (`detalle_rep_rech`). */
export interface DetalleBoleta {
  folio: number | null;
  tipo: number | null;
  /** DOK, RPR, RCH, RLV */
  estado: string;
  descripcion?: string;
  error?: unknown[];
}

/** Conteos por tipo que informa `getEstUp` en `RESP_BODY`. */
export interface ResumenTipoDte {
  tipo: number;
  informados: number;
  aceptados: number;
  rechazados: number;
  reparos: number;
}

export interface ResultadoDocumento {
  documentoId: string;
  /** Nuevo estado del documento, o null si no puede determinarse (queda como está). */
  estado: EstadoDocumento | null;
  /** Código SII por documento para `envio_documentos.estado`. */
  codigo: string;
  glosa: string;
  reparos: unknown;
}

export interface EntradaResultado {
  /** Código de estado del envío (EPR, RPR, RCH, ...). */
  estado: string;
  glosa: string;
  esFinal: boolean;
  documentos: DocumentoEnSobre[];
  /** Solo canal boleta. */
  detalleBoleta?: DetalleBoleta[];
  /** Solo canal dte. */
  resumenDte?: ResumenTipoDte[];
}

/** Extrae los conteos por tipo del `RESP_BODY` de `getEstUp` (objeto o lista, con números como texto). */
export function resumenDeCuerpo(cuerpo: unknown): ResumenTipoDte[] {
  if (cuerpo === null || cuerpo === undefined) return [];
  const lista = Array.isArray(cuerpo) ? cuerpo : [cuerpo];
  const resultado: ResumenTipoDte[] = [];
  for (const item of lista) {
    if (item === null || typeof item !== 'object') continue;
    const o = item as Record<string, unknown>;
    const tipo = Number(o['TIPO_DOCTO']);
    if (!Number.isFinite(tipo)) continue;
    resultado.push({
      tipo,
      informados: Number(o['INFORMADOS'] ?? 0),
      aceptados: Number(o['ACEPTADOS'] ?? 0),
      rechazados: Number(o['RECHAZADOS'] ?? 0),
      reparos: Number(o['REPAROS'] ?? 0),
    });
  }
  return resultado;
}

/**
 * Traduce el estado de un envío (y su detalle) al estado de cada documento del sobre.
 *
 * - Envío rechazado (RCH, RCO, RFR, RSC, RCT, RPT, VOF): todos `rechazado`.
 * - Envío no final: ningún documento cambia.
 * - Boletas: el SII solo lista los documentos con reparos o rechazos (`detalle_rep_rech`); los no
 *   listados quedan `aceptado`. DOK aceptado; RPR/RLV aceptado con reparos; RCH rechazado.
 * - DTE: `getEstUp` solo da conteos por tipo. Sin rechazos ni reparos: `aceptado`; todos con
 *   reparos: `aceptado_con_reparos`; todos rechazados: `rechazado`. Un resultado mezclado dentro de
 *   un mismo tipo no se puede atribuir a un documento: queda sin cambio y debe revisarse con
 *   `getEstDte` (pendiente).
 */
export function resolverResultado(e: EntradaResultado): ResultadoDocumento[] {
  const sinCambio = (d: DocumentoEnSobre, glosa = e.glosa): ResultadoDocumento => ({
    documentoId: d.documentoId,
    estado: null,
    codigo: e.estado,
    glosa,
    reparos: null,
  });

  if (ESTADOS_ENVIO_RECHAZADO.has(e.estado)) {
    return e.documentos.map((d) => ({
      documentoId: d.documentoId,
      estado: 'rechazado',
      codigo: e.estado,
      glosa: e.glosa,
      reparos: null,
    }));
  }
  if (!e.esFinal || (e.estado !== 'EPR' && e.estado !== 'RPR')) {
    return e.documentos.map((d) => sinCambio(d));
  }

  if (e.detalleBoleta !== undefined) {
    const porClave = new Map(
      e.detalleBoleta.map((x) => [`${x.tipo}-${x.folio}`, x] as const),
    );
    const todosConReparos = e.estado === 'RPR' && e.detalleBoleta.length === 0;
    return e.documentos.map((d) => {
      const x = porClave.get(`${d.tipoDte}-${d.folio}`);
      if (!x) {
        return {
          documentoId: d.documentoId,
          estado: todosConReparos ? 'aceptado_con_reparos' : 'aceptado',
          codigo: todosConReparos ? 'RPR' : 'DOK',
          glosa: todosConReparos ? e.glosa : 'Aceptado',
          reparos: null,
        };
      }
      const estado: EstadoDocumento =
        x.estado === 'RCH'
          ? 'rechazado'
          : x.estado === 'RPR' || x.estado === 'RLV'
            ? 'aceptado_con_reparos'
            : 'aceptado';
      return {
        documentoId: d.documentoId,
        estado,
        codigo: x.estado,
        glosa: x.descripcion ?? e.glosa,
        reparos: x.error && x.error.length > 0 ? x.error : null,
      };
    });
  }

  const resumen = e.resumenDte ?? [];
  return e.documentos.map((d) => {
    const r = resumen.find((x) => x.tipo === d.tipoDte);
    if (!r) {
      const conReparos = e.estado === 'RPR';
      return {
        documentoId: d.documentoId,
        estado: conReparos ? 'aceptado_con_reparos' : 'aceptado',
        codigo: e.estado,
        glosa: e.glosa,
        reparos: null,
      };
    }
    if (r.rechazados === 0 && r.reparos === 0) {
      return { documentoId: d.documentoId, estado: 'aceptado', codigo: 'DOK', glosa: 'Aceptado', reparos: null };
    }
    if (r.aceptados === 0 && r.reparos === 0 && r.rechazados > 0) {
      return { documentoId: d.documentoId, estado: 'rechazado', codigo: 'RCH', glosa: 'Rechazado', reparos: null };
    }
    if (r.aceptados === 0 && r.rechazados === 0 && r.reparos > 0) {
      return { documentoId: d.documentoId, estado: 'aceptado_con_reparos', codigo: 'RPR', glosa: 'Aceptado con reparos', reparos: null };
    }
    return sinCambio(
      d,
      `Resultado mixto en el tipo ${d.tipoDte} (${r.aceptados} aceptados, ${r.reparos} con reparos, ${r.rechazados} rechazados): consulte el estado por documento`,
    );
  });
}
