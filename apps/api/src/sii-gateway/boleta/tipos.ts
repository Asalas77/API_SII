/** Respuesta de `POST /boleta.electronica.envio` (ResultadoEnvioPost del OpenAPI). */
export interface RespuestaEnvioBoletaJson {
  /** Formato RUT-DV, ej. 45000054-K */
  rut_emisor: string;
  rut_envia: string;
  /** Hasta 15 dígitos. */
  trackid: number;
  /** YYYY-MM-DD HH:MM:SS */
  fecha_recepcion: string;
  /** REC = recibido */
  estado: string;
  file?: string;
}

export type ResultadoEnvio = RespuestaEnvioBoletaJson & {
  /** `trackid` como string (evita pérdida de precisión con 15 dígitos). */
  trackId: string;
};

export type CodigoEstadoEnvioBoleta =
  | 'REC' | 'EPR' | 'CRT' | 'FOK' | 'PRD' | 'RCH' | 'RCO'
  | 'VOF' | 'RFR' | 'RPR' | 'RPT' | 'RSC' | 'SOK' | 'RCT';

export interface EstadisticaEnvio {
  /** 39 o 41 */
  tipo: number;
  informados: number;
  aceptados: number;
  rechazados: number;
  reparos: number;
}

export interface ErrorDetalleBoleta {
  /** ENV, CRT, TED, CAF, DTE, HED, DET, REF, DRG */
  seccion: string;
  linea: number;
  /** 1 reparo leve, 2 reparo, 3 rechazo */
  nivel: number;
  codigo: number;
  descripcion: string;
  detalle: string;
}

export interface DetalleRepRech {
  folio: number | null;
  tipo: number | null;
  /** DOK, RPR, RCH, RLV */
  estado: string;
  descripcion?: string;
  error?: ErrorDetalleBoleta[];
}

/** Respuesta de `GET /boleta.electronica.envio/{rut}-{dv}-{trackid}`. */
export interface RespuestaEstadoEnvioJson {
  rut_emisor: string;
  rut_envia: string;
  trackid: number;
  /** DD/MM/YYYY HH:MM:SS */
  fecha_recepcion: string;
  estado: CodigoEstadoEnvioBoleta | (string & {});
  estadistica?: EstadisticaEnvio[];
  detalle_rep_rech?: DetalleRepRech[];
}

export type EstadoEnvioBoleta = RespuestaEstadoEnvioJson & {
  trackId: string;
  /** Glosa oficial del estado según el OpenAPI. */
  descripcionEstado: string;
  /** `true` si el SII ya no cambiará el estado del envío. */
  esFinal: boolean;
};

export type CodigoEstadoBoleta =
  | 'DOK' | 'DNK' | 'FAU' | 'FNA' | 'FAN' | 'EMP'
  | 'TMD' | 'TMC' | 'MMD' | 'MMC' | 'AND' | 'ANC';

/** Respuesta de `GET /boleta.electronica/{rut}-{dv}-{tipo}-{folio}/estado`. */
export interface EstadoBoleta {
  codigo: CodigoEstadoBoleta | (string & {});
  descripcion: string;
}

export interface ParametrosEstadoBoleta {
  /** 39 o 41 */
  tipo: number;
  folio: number;
  rutReceptor?: string | number;
  dvReceptor?: string;
  monto?: number;
  /** Formato DD-MM-YYYY */
  fechaEmision?: string;
}

/** Glosas oficiales (OpenAPI v1.0.5) de los estados de un envío de boletas. */
export const GLOSAS_ESTADO_ENVIO: Readonly<Record<CodigoEstadoEnvioBoleta, string>> = {
  REC: 'Envío recibido',
  EPR: 'Envío procesado',
  CRT: 'Carátula OK',
  FOK: 'Firma de envío validada',
  PRD: 'Envío en proceso',
  RCH: 'Rechazado por errores en información',
  RCO: 'Rechazado por consistencia',
  VOF: 'No se encontró el archivo .xml',
  RFR: 'Rechazado por error en firma',
  RPR: 'Aceptado con reparos',
  RPT: 'Envío repetido rechazado',
  RSC: 'Rechazado por schema',
  SOK: 'Schema validado',
  RCT: 'Rechazado por error en carátula',
};

/** Estados terminales: el SII no los modificará más. */
export const ESTADOS_ENVIO_FINALES: ReadonlySet<string> = new Set([
  'EPR', 'RCH', 'RCO', 'RFR', 'RPR', 'RPT', 'RSC', 'RCT', 'VOF',
]);

/** Glosas oficiales del estado de una boleta individual. */
export const GLOSAS_ESTADO_BOLETA: Readonly<Record<CodigoEstadoBoleta, string>> = {
  DOK: 'Documento recibido por el SII. Datos coinciden con los registrados',
  DNK: 'Documento recibido por el SII pero datos NO coinciden con los registrados',
  FAU: 'Documento no recibido por el SII',
  FNA: 'Documento no autorizado',
  FAN: 'Documento anulado',
  EMP: 'Empresa no autorizada a emitir documentos tributarios electrónicos',
  TMD: 'Existe nota de débito que modifica el texto del documento',
  TMC: 'Existe nota de crédito que modifica el texto',
  MMD: 'Existe nota de débito que modifica montos del documento',
  MMC: 'Existe nota de crédito que modifica montos del documento',
  AND: 'Existe nota de débito que anula el documento',
  ANC: 'Existe nota de crédito que anula el documento',
};
