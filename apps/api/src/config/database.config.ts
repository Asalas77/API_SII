import { registerAs } from '@nestjs/config';

export const databaseConfig = registerAs('database', () => ({
  host: process.env.DATABASE_HOST as string,
  port: Number(process.env.DATABASE_PORT ?? 5432),
  username: process.env.DATABASE_USER as string,
  password: process.env.DATABASE_PASSWORD as string,
  database: process.env.DATABASE_NAME as string,
  /** Rol de aplicación (sin BYPASSRLS) con el que la API se conecta en runtime; opcional salvo en producción. */
  appUsername: process.env.DATABASE_APP_USER || undefined,
  appPassword: process.env.DATABASE_APP_PASSWORD || undefined,
  ssl: process.env.DATABASE_SSL === 'true',
}));
