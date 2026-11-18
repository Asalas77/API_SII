import Joi from 'joi';

/** Esquema Joi del entorno: la app no arranca si falta o es inválida alguna variable. */
export const envValidationSchema = Joi.object({
  NODE_ENV: Joi.string()
    .valid('development', 'production', 'test')
    .default('development'),
  PORT: Joi.number().port().default(3000),

  DATABASE_HOST: Joi.string().required(),
  DATABASE_PORT: Joi.number().port().default(5432),
  DATABASE_USER: Joi.string().required(),
  DATABASE_PASSWORD: Joi.string().required(),
  DATABASE_NAME: Joi.string().required(),
  DATABASE_SSL: Joi.boolean().default(false),

  SII_AMBIENTE: Joi.string()
    .valid('certificacion', 'produccion')
    .default('certificacion'),

  // 32 bytes en base64.
  CERTIFICADOS_MASTER_KEY: Joi.string()
    .required()
    .custom((value: string, helpers) =>
      Buffer.from(value, 'base64').length === 32
        ? value
        : helpers.error('any.invalid'),
    )
    .messages({
      'any.invalid':
        'CERTIFICADOS_MASTER_KEY debe ser una clave de 32 bytes en base64 (openssl rand -base64 32)',
    }),
});
