import { registerAs } from '@nestjs/config';

export const seguridadConfig = registerAs('seguridad', () => ({
  /** Clave maestra AES de 32 bytes para cifrar PFX en reposo. */
  certificadosMasterKey: Buffer.from(
    process.env.CERTIFICADOS_MASTER_KEY ?? '',
    'base64',
  ),
}));
