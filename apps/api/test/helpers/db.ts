import { existsSync } from 'node:fs';
import { DataSource } from 'typeorm';

/** Mismo mecanismo que src/database/data-source.ts: .env.local y .env sin dependencias. */
export function cargarEntorno(): void {
  for (const archivo of ['.env.local', '.env']) {
    if (existsSync(archivo)) process.loadEnvFile(archivo);
  }
}

/**
 * true si hay variables DATABASE_* Y Postgres responde en menos de `timeoutMs`.
 * Los e2e usan `describe.skipIf(!(await postgresDisponible()))` para omitirse en segundos (en lugar
 * de agotar el timeout del hook) cuando la base está apagada.
 */
export async function postgresDisponible(timeoutMs = 1500): Promise<boolean> {
  cargarEntorno();
  if (!process.env.DATABASE_HOST) return false;
  const ds = new DataSource({
    type: 'postgres',
    host: process.env.DATABASE_HOST,
    port: Number(process.env.DATABASE_PORT ?? 5432),
    username: process.env.DATABASE_USER,
    password: process.env.DATABASE_PASSWORD,
    database: process.env.DATABASE_NAME,
    connectTimeoutMS: timeoutMs,
    extra: { connectionTimeoutMillis: timeoutMs },
  });
  try {
    await ds.initialize();
    await ds.query('SELECT 1');
    return true;
  } catch {
    return false;
  } finally {
    if (ds.isInitialized) await ds.destroy().catch(() => undefined);
  }
}

/** RUT chileno aleatorio de 8 dígitos (cuerpo 90.000.000+) con su DV correcto. */
export function rutAleatorio(calcularDv: (n: number) => string): {
  numero: number;
  dv: string;
  texto: string;
} {
  const numero = 90_000_000 + Math.floor(Math.random() * 9_000_000);
  const dv = calcularDv(numero);
  return { numero, dv, texto: `${numero}-${dv}` };
}
