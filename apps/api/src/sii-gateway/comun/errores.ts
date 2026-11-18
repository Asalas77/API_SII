/** Error base de cualquier fallo al hablar con el SII. */
export class SiiError extends Error {
  readonly statusHttp?: number;
  readonly cuerpo?: string;

  constructor(
    mensaje: string,
    opciones: { statusHttp?: number; cuerpo?: string; cause?: unknown } = {},
  ) {
    super(mensaje, opciones.cause === undefined ? undefined : { cause: opciones.cause });
    this.name = new.target.name;
    this.statusHttp = opciones.statusHttp;
    this.cuerpo = opciones.cuerpo;
  }
}

/** HTTP 401 o ESTADO distinto de 00 al obtener semilla/token. */
export class SiiAutenticacionError extends SiiError {}

/** HTTP 405: "Límite excedido". Reintentable con backoff. */
export class SiiLimiteExcedidoError extends SiiError {}

/** HTTP 400: petición con error. No reintentable. */
export class SiiPeticionInvalidaError extends SiiError {}

/** HTTP 404. */
export class SiiNoEncontradoError extends SiiError {}

/** HTTP 5xx. Reintentable. */
export class SiiServidorError extends SiiError {}

/** Fallo de red (fetch lanzó). Reintentable. */
export class SiiRedError extends SiiError {}

/** Upload de DTE con STATUS distinto de 0 en RECEPCIONDTE. */
export class SiiEnvioDteError extends SiiError {
  readonly status: string;
  readonly glosa: string;
  readonly errores: string[];

  constructor(status: string, glosa: string, errores: string[] = [], cuerpo?: string) {
    super(
      `Envío DTE rechazado (STATUS ${status}): ${glosa}${errores.length ? ` - ${errores.join('; ')}` : ''}`,
      { cuerpo },
    );
    this.status = status;
    this.glosa = glosa;
    this.errores = errores;
  }
}

/** Mapea un status HTTP no exitoso a la subclase de error correspondiente. */
export function errorDesdeHttp(status: number, cuerpo: string, contexto: string): SiiError {
  const detalle = cuerpo.trim().slice(0, 500);
  const msg = `${contexto}: HTTP ${status}${detalle ? ` - ${detalle}` : ''}`;
  const op = { statusHttp: status, cuerpo };
  if (status === 400) return new SiiPeticionInvalidaError(msg, op);
  if (status === 401) return new SiiAutenticacionError(msg, op);
  if (status === 404) return new SiiNoEncontradoError(msg, op);
  if (status === 405) return new SiiLimiteExcedidoError(`${contexto}: Límite excedido (HTTP 405)`, op);
  if (status >= 500) return new SiiServidorError(msg, op);
  return new SiiError(msg, op);
}
