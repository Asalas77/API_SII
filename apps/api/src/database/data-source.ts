import 'reflect-metadata';
import { existsSync } from 'node:fs';
import { DataSource } from 'typeorm';

// Carga .env / .env.local sin dependencias (Node >= 20.12). loadEnvFile no
// sobrescribe variables ya exportadas, así que el entorno real tiene prioridad.
for (const archivo of ['.env.local', '.env']) {
  if (existsSync(archivo)) process.loadEnvFile(archivo);
}

/** DataSource usado solo por la CLI de TypeORM (migration:*). */
export default new DataSource({
  type: 'postgres',
  host: process.env.DATABASE_HOST ?? 'localhost',
  port: Number(process.env.DATABASE_PORT ?? 5432),
  username: process.env.DATABASE_USER ?? 'api_sii',
  password: process.env.DATABASE_PASSWORD ?? 'api_sii',
  database: process.env.DATABASE_NAME ?? 'api_sii',
  ssl:
    process.env.DATABASE_SSL === 'true' ? { rejectUnauthorized: false } : false,
  // Entidades de cualquier módulo, para que migration:generate las vea.
  entities: [`${import.meta.dirname}/../**/*.entity{.ts,.js}`],
  migrations: [`${import.meta.dirname}/migrations/*{.ts,.js}`],
  synchronize: false,
});
