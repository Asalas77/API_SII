/**
 * Códigos de estado del intercambio de información entre contribuyentes
 * (`RespuestaEnvioDTE_v10.xsd`, formato de respuesta a DTE v1.0 de 2005-04-13).
 * Los XSD mandan sobre los PDF; los códigos y glosas de abajo salen de las enumeraciones del XSD.
 */

/** `RecepcionEnvio/EstadoRecepEnv`. */
export const EstadoRecepEnv = {
  OK: 0,
  ERROR_SCHEMA: 1,
  ERROR_FIRMA: 2,
  RUT_RECEPTOR_NO_CORRESPONDE: 3,
  ARCHIVO_REPETIDO: 90,
  ARCHIVO_ILEGIBLE: 91,
  OTROS: 99,
} as const;
export type EstadoRecepEnvCodigo = (typeof EstadoRecepEnv)[keyof typeof EstadoRecepEnv];

export const GLOSA_RECEP_ENV: Record<EstadoRecepEnvCodigo, string> = {
  0: 'Envio Recibido Conforme',
  1: 'Envio Rechazado - Error de Schema',
  2: 'Envio Rechazado - Error de Firma',
  3: 'Envio Rechazado - RUT Receptor No Corresponde',
  90: 'Envio Rechazado - Archivo Repetido',
  91: 'Envio Rechazado - Archivo Ilegible',
  99: 'Envio Rechazado - Otros',
};

/** `RecepcionEnvio/RecepcionDTE/EstadoRecepDTE`. */
export const EstadoRecepDte = {
  OK: 0,
  ERROR_FIRMA: 1,
  ERROR_RUT_EMISOR: 2,
  ERROR_RUT_RECEPTOR: 3,
  REPETIDO: 4,
  OTROS: 99,
} as const;
export type EstadoRecepDteCodigo = (typeof EstadoRecepDte)[keyof typeof EstadoRecepDte];

export const GLOSA_RECEP_DTE: Record<EstadoRecepDteCodigo, string> = {
  0: 'DTE Recibido OK',
  1: 'DTE No Recibido - Error de Firma',
  2: 'DTE No Recibido - Error en RUT Emisor',
  3: 'DTE No Recibido - Error en RUT Receptor',
  4: 'DTE No Recibido - DTE Repetido',
  99: 'DTE No Recibido - Otros',
};

/** `ResultadoDTE/EstadoDTE` (aprobación comercial). */
export const EstadoDte = {
  ACEPTADO: 0,
  ACEPTADO_CON_DISCREPANCIAS: 1,
  RECHAZADO: 2,
} as const;
export type EstadoDteCodigo = (typeof EstadoDte)[keyof typeof EstadoDte];

export const GLOSA_ESTADO_DTE: Record<EstadoDteCodigo, string> = {
  0: 'DTE Aceptado OK',
  1: 'DTE Aceptado con Discrepancias',
  2: 'DTE Rechazado',
};
