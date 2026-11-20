import { registerAs } from '@nestjs/config';

export const authConfig = registerAs('auth', () => ({
  /** Clave de administración bootstrap (opcional, ≥ 32 caracteres). Concede todo. */
  adminKey: process.env.API_ADMIN_KEY || undefined,
}));
