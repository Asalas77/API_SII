import { envValidationSchema } from './env.validation.js';

const base = {
  DATABASE_HOST: 'h',
  DATABASE_USER: 'u',
  DATABASE_PASSWORD: 'p',
  DATABASE_NAME: 'n',
  CERTIFICADOS_MASTER_KEY: Buffer.alloc(32).toString('base64'),
};

describe('validación del rol de aplicación', () => {
  it('es opcional fuera de producción', () => {
    expect(envValidationSchema.validate({ ...base, NODE_ENV: 'development' }).error).toBeUndefined();
  });
  it('usuario y contraseña van juntos', () => {
    expect(envValidationSchema.validate({ ...base, DATABASE_APP_USER: 'a' }).error).toBeDefined();
  });
  it('es obligatorio en producción', () => {
    expect(envValidationSchema.validate({ ...base, NODE_ENV: 'production' }).error).toBeDefined();
    expect(
      envValidationSchema.validate({
        ...base,
        NODE_ENV: 'production',
        DATABASE_APP_USER: 'a',
        DATABASE_APP_PASSWORD: 'b',
      }).error,
    ).toBeUndefined();
  });
});

describe('EXIGIR_TRASLADO_GUIAS (Res. Ex. SII 144/2026)', () => {
  it('es true por defecto y acepta false', () => {
    expect(envValidationSchema.validate({ ...base }).value.EXIGIR_TRASLADO_GUIAS).toBe(true);
    expect(envValidationSchema.validate({ ...base, EXIGIR_TRASLADO_GUIAS: 'false' }).value.EXIGIR_TRASLADO_GUIAS).toBe(false);
    expect(envValidationSchema.validate({ ...base, EXIGIR_TRASLADO_GUIAS: 'quizas' }).error).toBeDefined();
  });
});
