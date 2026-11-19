import {
  type INestApplication,
  StandardSchemaValidationPipe,
} from '@nestjs/common';
import { ProblemaHttp } from './comun/problema.js';
import { ProblemFilter } from './comun/problem.filter.js';

/** Configuración HTTP común a `main.ts` y a los e2e: prefijo `/v1`, validación y errores. */
export function configurarApp(app: INestApplication): void {
  // Los recursos de negocio viven bajo /v1; "/" y /health quedan sin prefijo.
  app.setGlobalPrefix('v1', { exclude: ['health', '/'] });
  app.useGlobalFilters(new ProblemFilter());
  app.useGlobalPipes(
    new StandardSchemaValidationPipe({
      validateOptions: { abortEarly: false },
      exceptionFactory: (issues) =>
        new ProblemaHttp(
          400,
          'VALIDACION',
          'Solicitud inválida',
          'Los datos enviados no son válidos',
          issues.map((i) => ({
            campo: i.path
              ?.map((s) => (typeof s === 'object' ? String(s.key) : String(s)))
              .join('.'),
            mensaje: i.message,
          })),
        ),
    }),
  );
}
