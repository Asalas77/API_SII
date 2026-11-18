/** No hay folios vigentes disponibles para la empresa y el tipo de DTE. */
export class SinFoliosDisponiblesError extends Error {
  constructor(
    readonly empresaId: string,
    readonly tipoDte: number,
  ) {
    super(
      `Sin folios disponibles para la empresa ${empresaId} y tipo de DTE ${tipoDte}`,
    );
    this.name = 'SinFoliosDisponiblesError';
  }
}

/** El rango del CAF es inválido o se solapa con otro CAF de la misma empresa y tipo. */
export class CafInvalidoError extends Error {
  constructor(mensaje: string) {
    super(mensaje);
    this.name = 'CafInvalidoError';
  }
}
