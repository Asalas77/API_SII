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
  // Rol de aplicación (sujeto a RLS). Opcional salvo en producción; ambas variables van juntas.
  DATABASE_APP_USER: Joi.string().optional(),
  DATABASE_APP_PASSWORD: Joi.string().optional(),

  SII_AMBIENTE: Joi.string()
    .valid('certificacion', 'produccion')
    .default('certificacion'),

  // Res. Ex. SII 144/2026: acepta IndTraslado 10-12 (GDT, traslado prolongado). Desactivado mientras el XSD oficial
  // del SII no los enumere (el SII rechazaría el documento).
  PERMITIR_INDTRASLADO_RES144: Joi.boolean().default(false),
  // Res. Ex. SII 144/2026 (vigente desde el 2026-11-01): toda guía de despacho (52) debe traer el bloque `traslado`.
  // Con true, emitir un 52 sin él responde 422. El set de pruebas de certificación queda exento (no trae transporte).
  EXIGIR_TRASLADO_GUIAS: Joi.boolean().default(true),

  // Sondeo automático de los buzones de correo de intercambio (IMAP). Desactivado por defecto; nunca corre con
  // NODE_ENV=test. `BUZON_CORREO_TICK_SEGUNDOS` es cada cuánto se revisa qué buzones ya cumplieron su intervalo.
  BUZON_CORREO_HABILITADO: Joi.boolean().default(false),
  BUZON_CORREO_TICK_SEGUNDOS: Joi.number().integer().min(5).default(30),

  // Clave de administración bootstrap: opcional, pero si se define debe tener ≥ 32 caracteres.
  API_ADMIN_KEY: Joi.string().min(32).optional().messages({
    'string.min':
      'API_ADMIN_KEY debe tener al menos 32 caracteres (openssl rand -base64 48)',
  }),

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
})
  .and('DATABASE_APP_USER', 'DATABASE_APP_PASSWORD')
  .custom((env: Record<string, unknown>, helpers) =>
    env.NODE_ENV === 'production' && !env.DATABASE_APP_USER
      ? helpers.error('any.invalid')
      : env,
  )
  .messages({
    'any.invalid':
      'En producción DATABASE_APP_USER y DATABASE_APP_PASSWORD son obligatorias (rol de aplicación sin BYPASSRLS, ver src/database/README.md)',
  });
