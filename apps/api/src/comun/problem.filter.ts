import {
  type ArgumentsHost,
  Catch,
  type ExceptionFilter,
  HttpException,
  Logger,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import { randomUUID } from 'node:crypto';
import { ErrorValidacionDte } from '../dte-core/index.js';
import {
  CafInvalidoError,
  SinFoliosDisponiblesError,
} from '../folios/folios.errors.js';
import {
  SiiEnvioDteError,
  SiiError,
  SiiPeticionInvalidaError,
} from '../sii-gateway/index.js';
import { ProblemaHttp, type DetalleError } from './problema.js';

interface Problema {
  status: number;
  code: string;
  title: string;
  detail: string;
  errors?: DetalleError[];
}

const TITULOS: Record<number, [string, string]> = {
  400: ['VALIDACION', 'Solicitud inválida'],
  401: ['NO_AUTENTICADO', 'No autenticado'],
  403: ['NO_AUTORIZADO', 'No autorizado'],
  404: ['NO_ENCONTRADO', 'No encontrado'],
  409: ['CONFLICTO', 'Conflicto'],
  413: ['ARCHIVO_DEMASIADO_GRANDE', 'Archivo demasiado grande'],
  422: ['ENTIDAD_NO_PROCESABLE', 'Entidad no procesable'],
};

/** Traduce una excepción cualquiera al problema HTTP que corresponde. */
export function aProblema(e: unknown): Problema {
  if (e instanceof ProblemaHttp) {
    return {
      status: e.getStatus(),
      code: e.code,
      title: e.title,
      detail: e.detail,
      errors: e.errors,
    };
  }
  if (e instanceof SinFoliosDisponiblesError) {
    return {
      status: 409,
      code: 'SIN_FOLIOS_DISPONIBLES',
      title: 'Sin folios disponibles',
      detail: e.message,
    };
  }
  if (e instanceof CafInvalidoError) {
    return { status: 422, code: 'CAF_INVALIDO', title: 'CAF inválido', detail: e.message };
  }
  if (e instanceof ErrorValidacionDte) {
    return {
      status: 422,
      code: 'DOCUMENTO_INVALIDO',
      title: 'Documento inválido',
      detail: e.message,
    };
  }
  if (e instanceof SiiEnvioDteError || e instanceof SiiPeticionInvalidaError) {
    return {
      status: 502,
      code: 'SII_RECHAZO',
      title: 'El SII rechazó la solicitud',
      detail: e.message,
    };
  }
  if (e instanceof SiiError) {
    return {
      status: 502,
      code: 'SII_NO_DISPONIBLE',
      title: 'SII no disponible',
      detail: e.message,
    };
  }
  if (e instanceof HttpException) {
    const status = e.getStatus();
    const [code, title] = TITULOS[status] ?? ['ERROR', 'Error'];
    const r = e.getResponse();
    const mensaje =
      typeof r === 'string'
        ? r
        : Array.isArray((r as { message?: unknown }).message)
          ? (r as { message: string[] }).message.join('; ')
          : String((r as { message?: string }).message ?? e.message);
    return { status, code, title, detail: mensaje };
  }
  return {
    status: 500,
    code: 'ERROR_INTERNO',
    title: 'Error interno',
    detail: 'Ocurrió un error inesperado',
  };
}

/** Filtro global: todas las respuestas de error son `application/problem+json` (RFC 9457). */
@Catch()
export class ProblemFilter implements ExceptionFilter {
  private readonly logger = new Logger('Errores');

  catch(exception: unknown, host: ArgumentsHost): void {
    const http = host.switchToHttp();
    const res = http.getResponse<Response>();
    const req = http.getRequest<Request>();
    const p = aProblema(exception);
    const requestId = String(req.headers['x-request-id'] ?? randomUUID());
    if (p.status >= 500) {
      this.logger.error(
        `${req.method} ${req.url}: ${exception instanceof Error ? (exception.stack ?? exception.message) : String(exception)}`,
      );
    }
    res
      .status(p.status)
      .type('application/problem+json')
      .setHeader('X-Request-Id', requestId)
      .send({
        type: `https://api-sii.example/errores/${p.code.toLowerCase().replace(/_/g, '-')}`,
        title: p.title,
        status: p.status,
        code: p.code,
        detail: p.detail,
        requestId,
        ...(p.errors ? { errors: p.errors } : {}),
      });
  }
}
