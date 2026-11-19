import { HttpException } from '@nestjs/common';

export interface DetalleError {
  campo?: string;
  mensaje: string;
}

/** Error de la API con el formato `application/problem+json` (RFC 9457) y un `code` estable. */
export class ProblemaHttp extends HttpException {
  constructor(
    status: number,
    readonly code: string,
    readonly title: string,
    readonly detail: string,
    readonly errors?: DetalleError[],
  ) {
    super({ code, title, detail, errors }, status);
  }
}

export const noEncontrado = (que: string, id: string) =>
  new ProblemaHttp(404, 'NO_ENCONTRADO', 'No encontrado', `${que} ${id} no existe`);

export const documentoInvalido = (detail: string, errors?: DetalleError[]) =>
  new ProblemaHttp(422, 'DOCUMENTO_INVALIDO', 'Documento inválido', detail, errors);
