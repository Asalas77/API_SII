import type { EstadoDocumento } from './entities/documento.entity.js';

/**
 * Códigos de estado de documento del SII (`getEstDte` y estado de boleta). Fuente:
 * `SII_WS_Estado_DTE_QueryEstDte.pdf`, tabla 3-4. Cualquier otro valor del campo ESTADO es un error
 * de consulta (-1 a -14, 001-003) o un código desconocido: no describe al documento.
 */
export const CODIGOS_ESTADO_SII: ReadonlySet<string> = new Set([
  'DOK',
  'DNK',
  'FAU',
  'FNA',
  'FAN',
  'EMP',
  'TMD',
  'TMC',
  'MMD',
  'MMC',
  'AND',
  'ANC',
]);

/** Estados de emisión desde los que ya tiene sentido preguntar al SII (el documento salió en un envío). */
export const ESTADOS_CONSULTABLES: ReadonlySet<EstadoDocumento> = new Set([
  'enviado',
  'aceptado',
  'aceptado_con_reparos',
  'rechazado',
  'anulado',
]);

export interface MapeoEstadoSii {
  /** Nuevo `documentos.estado`, o null si queda como está. */
  estado: EstadoDocumento | null;
  /** Aviso para el cliente (datos que no coinciden, documento aún no recibido, inconsistencias). */
  advertencia?: string;
}

/** true si el ESTADO devuelto no es un estado de documento (error de consulta o desconocido). */
export function esErrorDeConsulta(codigo: string): boolean {
  return !CODIGOS_ESTADO_SII.has(codigo.trim().toUpperCase());
}

/**
 * Traduce el código de `getEstDte` / estado de boleta al estado de emisión del documento.
 *
 * | Código SII | Efecto en `estado` | Notas |
 * |---|---|---|
 * | DOK, TMD, TMC, MMD, MMC | `enviado` -> `aceptado` | Nunca degrada `aceptado_con_reparos`. |
 * | AND, ANC | `enviado` -> `aceptado` | Hay una nota que anula el documento; el documento en sí fue aceptado. La anulación queda solo en `estado_sii`. |
 * | FAN | `enviado`/`aceptado`/`aceptado_con_reparos` -> `anulado` | El SII lo informa anulado. |
 * | FNA, EMP | `enviado` -> `rechazado` | |
 * | DNK | sin cambio | Advertencia: los datos consultados no coinciden con los registrados. |
 * | FAU | sin cambio | Advertencia: el SII aún no lo recibe. |
 *
 * Los demás estados de partida (`rechazado`, `anulado`, ...) no se pisan: si el SII contradice el
 * estado local se informa en `advertencia` y se revisa a mano.
 */
export function mapearEstadoSii(codigoSii: string, estadoActual: EstadoDocumento): MapeoEstadoSii {
  const codigo = codigoSii.trim().toUpperCase();
  const aceptable = estadoActual === 'aceptado' || estadoActual === 'aceptado_con_reparos';
  switch (codigo) {
    case 'DOK':
    case 'TMD':
    case 'TMC':
    case 'MMD':
    case 'MMC':
    case 'AND':
    case 'ANC':
      if (estadoActual === 'enviado') return { estado: 'aceptado' };
      if (aceptable || estadoActual === 'anulado') return { estado: null };
      return {
        estado: null,
        advertencia: `El SII informa ${codigo} pero el documento figura ${estadoActual}; revíselo manualmente`,
      };
    case 'FAN':
      if (estadoActual === 'enviado' || aceptable) return { estado: 'anulado' };
      return { estado: null };
    case 'FNA':
    case 'EMP':
      if (estadoActual === 'enviado') return { estado: 'rechazado' };
      if (estadoActual === 'rechazado') return { estado: null };
      return {
        estado: null,
        advertencia: `El SII informa ${codigo} pero el documento figura ${estadoActual}; revíselo manualmente`,
      };
    case 'DNK':
      return {
        estado: null,
        advertencia:
          'El SII recibió el documento pero los datos consultados (receptor, monto o fecha de emisión) no coinciden con los registrados; verifique esos datos',
      };
    case 'FAU':
      return {
        estado: null,
        advertencia: 'El SII aún no registra el documento; reintente la consulta más tarde',
      };
    default:
      return { estado: null };
  }
}
