/** Error de validación de negocio al armar un documento o sobre (datos de entrada inválidos). */
export class ErrorValidacionDte extends Error {
  constructor(mensaje: string) {
    super(mensaje);
    this.name = 'ErrorValidacionDte';
  }
}
