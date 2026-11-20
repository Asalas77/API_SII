import { DataSource } from 'typeorm';
import { ApiKey } from '../../src/auth/entities/api-key.entity.js';
import { Certificado } from '../../src/certificados/entities/certificado.entity.js';
import { Documento } from '../../src/documentos/entities/documento.entity.js';
import { Empresa } from '../../src/empresas/entities/empresa.entity.js';
import { EnvioDocumento } from '../../src/envios/entities/envio-documento.entity.js';
import { Envio } from '../../src/envios/entities/envio.entity.js';
import { Caf } from '../../src/folios/entities/caf.entity.js';
import { Libro } from '../../src/libros/entities/libro.entity.js';
import { cargarEntorno } from './db.js';

/**
 * DataSource de FIXTURES de los e2e: siembra y limpia datos directamente en la base, sin pasar por
 * la API. Se conecta con el dueño del esquema (DATABASE_USER) y fija a nivel de sesión
 * `app.todas_empresas = on` (opción de arranque de la conexión), de modo que ve todas las empresas
 * aunque el dueño no sea superusuario y RLS esté FORZADA. Es una conexión dedicada de test: la
 * aplicación nunca fija este valor a nivel de sesión.
 */
export async function crearDsFixtures(): Promise<DataSource> {
  cargarEntorno();
  const ds = new DataSource({
    type: 'postgres',
    host: process.env.DATABASE_HOST,
    port: Number(process.env.DATABASE_PORT ?? 5432),
    username: process.env.DATABASE_USER,
    password: process.env.DATABASE_PASSWORD,
    database: process.env.DATABASE_NAME,
    entities: [Empresa, Certificado, Caf, Documento, Envio, EnvioDocumento, Libro, ApiKey],
    extra: { options: '-c app.todas_empresas=on' },
  });
  await ds.initialize();
  return ds;
}
