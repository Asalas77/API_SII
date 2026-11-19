import { BadRequestException } from '@nestjs/common';
import { ErrorValidacionDte } from '../dte-core/index.js';
import { CafInvalidoError, SinFoliosDisponiblesError } from '../folios/folios.errors.js';
import { SiiEnvioDteError, SiiServidorError } from '../sii-gateway/index.js';
import { aFechaCalendario, fechaSantiago } from './fechas.js';
import { aProblema } from './problem.filter.js';
import { noEncontrado } from './problema.js';

describe('fechas', () => {
  it('fechaSantiago usa la zona America/Santiago', () => {
    expect(fechaSantiago(new Date('2026-11-15T02:00:00Z'))).toBe('2026-11-14');
    expect(fechaSantiago(new Date('2026-11-15T12:00:00Z'))).toBe('2026-11-15');
  });

  it('aFechaCalendario valida strings', () => {
    expect(aFechaCalendario('2026-01-31')).toBe('2026-01-31');
    expect(() => aFechaCalendario('31-01-2026')).toThrow();
  });
});

describe('aProblema', () => {
  it('mapea los errores de dominio a su status y code', () => {
    expect(aProblema(new SinFoliosDisponiblesError('e', 33))).toMatchObject({ status: 409, code: 'SIN_FOLIOS_DISPONIBLES' });
    expect(aProblema(new CafInvalidoError('x'))).toMatchObject({ status: 422, code: 'CAF_INVALIDO' });
    expect(aProblema(new ErrorValidacionDte('x'))).toMatchObject({ status: 422, code: 'DOCUMENTO_INVALIDO' });
    expect(aProblema(new SiiServidorError('x', {}))).toMatchObject({ status: 502, code: 'SII_NO_DISPONIBLE' });
    expect(aProblema(new SiiEnvioDteError('1', 'g'))).toMatchObject({
      status: 502,
      code: 'SII_RECHAZO',
    });
    expect(aProblema(noEncontrado('El documento', 'z'))).toMatchObject({ status: 404, code: 'NO_ENCONTRADO' });
    expect(aProblema(new BadRequestException('mal'))).toMatchObject({ status: 400, code: 'VALIDACION', detail: 'mal' });
    expect(aProblema(new Error('boom'))).toMatchObject({ status: 500, code: 'ERROR_INTERNO' });
  });
});
