/**
 * Error de validación de negocio al armar un documento o sobre (datos de entrada inválidos).
 * `campo` (opcional) es la ruta del campo de entrada culpable (`traslado.chofer.rut`); la API lo
 * devuelve en `errors[]` del problema 422.
 */
export class ErrorValidacionDte extends Error {
  constructor(
    mensaje: string,
    readonly campo?: string,
  ) {
    super(mensaje);
    this.name = 'ErrorValidacionDte';
  }
}
