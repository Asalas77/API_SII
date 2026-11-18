import { registerAs } from '@nestjs/config';

export const databaseConfig = registerAs('database', () => ({
  host: process.env.DATABASE_HOST as string,
  port: Number(process.env.DATABASE_PORT ?? 5432),
  username: process.env.DATABASE_USER as string,
  password: process.env.DATABASE_PASSWORD as string,
  database: process.env.DATABASE_NAME as string,
  ssl: process.env.DATABASE_SSL === 'true',
}));
