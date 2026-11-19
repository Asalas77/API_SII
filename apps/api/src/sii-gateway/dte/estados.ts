/**
 * Clasificación de los estados de los servicios SOAP de consulta DTE del SII.
 * Fuentes: `SII_WS_Estado_Envio_QueryEstUp.pdf` (3.3, 3.5) y `SII_WS_Estado_DTE_QueryEstDte.pdf` (3.3, 3.5).
 */

export interface ClasificacionEstado {
  descripcionEstado: string;
  /** true si el SII no cambiará más el estado (el consumidor puede dejar de consultar). */
  esFinal: boolean;
}

/** Estados de `getEstUp` (estado de un envío por TrackId). */
const ESTADOS_ENVIO: Readonly<Record<string, ClasificacionEstado>> = {
  REC: { descripcionEstado: 'Envío recibido', esFinal: false },
  SOK: { descripcionEstado: 'Schema validado', esFinal: false },
  CRT: { descripcionEstado: 'Carátula OK', esFinal: false },
  FOK: { descripcionEstado: 'Firma de envío validada', esFinal: false },
  PDR: { descripcionEstado: 'Envío en proceso', esFinal: false },
  PRD: { descripcionEstado: 'Envío en proceso', esFinal: false },
  EPR: { descripcionEstado: 'Envío procesado', esFinal: true },
  RPR: { descripcionEstado: 'Aceptado con reparos', esFinal: true },
  RCH: { descripcionEstado: 'Rechazado por errores en información', esFinal: true },
  RCO: { descripcionEstado: 'Rechazado por consistencia', esFinal: true },
  RCT: { descripcionEstado: 'Rechazado por error en carátula', esFinal: true },
  RFR: { descripcionEstado: 'Rechazado por error en firma', esFinal: true },
  RSC: { descripcionEstado: 'Rechazado por error en schema', esFinal: true },
  RPT: { descripcionEstado: 'Envío repetido rechazado', esFinal: true },
  VOF: { descripcionEstado: 'No se encontró el archivo XML', esFinal: true },
};

/** Estados de `getEstDte` (estado de un documento). */
const ESTADOS_DTE: Readonly<Record<string, ClasificacionEstado>> = {
  DOK: { descripcionEstado: 'Documento recibido por el SII. Datos coinciden con los registrados', esFinal: true },
  DNK: { descripcionEstado: 'Documento recibido por el SII pero datos NO coinciden con los registrados', esFinal: true },
  // Puede pasar a DOK/DNK si el documento llega después.
  FAU: { descripcionEstado: 'Documento no recibido por el SII', esFinal: false },
  FNA: { descripcionEstado: 'Documento no autorizado', esFinal: true },
  FAN: { descripcionEstado: 'Documento anulado', esFinal: true },
  EMP: { descripcionEstado: 'Empresa no autorizada a emitir documentos tributarios electrónicos', esFinal: true },
  TMD: { descripcionEstado: 'Existe nota de débito que modifica el texto del documento', esFinal: true },
  TMC: { descripcionEstado: 'Existe nota de crédito que modifica el texto del documento', esFinal: true },
  MMD: { descripcionEstado: 'Existe nota de débito que modifica los montos del documento', esFinal: true },
  MMC: { descripcionEstado: 'Existe nota de crédito que modifica los montos del documento', esFinal: true },
  AND: { descripcionEstado: 'Existe nota de débito que anula el documento', esFinal: true },
  ANC: { descripcionEstado: 'Existe nota de crédito que anula el documento', esFinal: true },
};

/** ESTADO de error común a ambos servicios (autenticación y errores de consulta). */
const ESTADOS_ERROR: Readonly<Record<string, string>> = {
  '001': 'Cookie/token inactivo',
  '002': 'Token inactivo',
  '003': 'Token no existe',
  '-1': 'Error: no existe el campo estado en el retorno',
  '-2': 'Error de retorno',
  '-3': 'Error: RUT del usuario no existe',
  '-4': 'Error de obtención de datos',
  '-5': 'Error de retorno de datos',
  '-6': 'Error: usuario no autorizado',
  '-7': 'Error de retorno de datos',
  '-8': 'Error de retorno de datos',
  '-9': 'Error de retorno de datos',
  '-10': 'Error: validación del RUT del usuario',
  '-11': 'Error de proceso (ver ERR_CODE, SQL_CODE, SRV_CODE)',
  '-12': 'Error de retorno de consulta',
  '-13': 'Error: RUT del usuario nulo',
  '-14': 'Error en el XML de retorno',
};

function clasificar(
  tabla: Readonly<Record<string, ClasificacionEstado>>,
  estado: string,
): ClasificacionEstado {
  const e = estado.trim().toUpperCase();
  const conocido = tabla[e];
  if (conocido) return conocido;
  const error = ESTADOS_ERROR[e];
  if (error) return { descripcionEstado: error, esFinal: false };
  return { descripcionEstado: `Estado desconocido: ${estado}`, esFinal: false };
}

/** Clasifica el ESTADO de `getEstUp`. Los estados de error de consulta no son finales (se puede reintentar). */
export function clasificarEstadoEnvioDte(estado: string): ClasificacionEstado {
  return clasificar(ESTADOS_ENVIO, estado);
}

/** Clasifica el ESTADO de `getEstDte`. */
export function clasificarEstadoDte(estado: string): ClasificacionEstado {
  return clasificar(ESTADOS_DTE, estado);
}
