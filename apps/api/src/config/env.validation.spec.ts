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
