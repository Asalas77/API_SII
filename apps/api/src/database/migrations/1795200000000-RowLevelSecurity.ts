import type { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Row Level Security por empresa (segunda barrera de aislamiento; la primera son los guards y los
 * servicios, ver src/auth/README.md y la sección RLS de src/database/README.md).
 *
 * - Crea el rol de aplicación (`DATABASE_APP_USER`, por defecto `api_sii_app`): NOSUPERUSER,
 *   NOBYPASSRLS, NOCREATEROLE, NOCREATEDB. Con contraseña (`DATABASE_APP_PASSWORD`) puede iniciar
 *   sesión; sin ella queda NOLOGIN y se avisa por consola.
 * - Activa y FUERZA RLS en las tablas con datos de empresa. El contexto llega por las variables de
 *   transacción `app.todas_empresas` y `app.empresas` (ver EjecutorEmpresa). Sin ellas: cero filas.
 * - `api_keys` queda SIN RLS a propósito: se consulta ANTES de conocer al principal (es la tabla que
 *   lo determina) y solo guarda prefijo + hash SHA-256 (nunca secretos).
 *
 * Importante: con FORCE, ni siquiera el dueño de las tablas (si no es superusuario) ve filas sin
 * contexto. Una migración futura que toque datos de estas tablas debe fijar antes
 * `set_config('app.todas_empresas', 'on', true)` dentro de su transacción.
 */
export class RowLevelSecurity1795200000000 implements MigrationInterface {
  name = 'RowLevelSecurity1795200000000';

  /** Tablas con `empresa_id` directo. */
  private static readonly TABLAS_EMPRESA = ['certificados', 'cafs', 'documentos', 'envios'];
  /** Todas las tablas de negocio a las que el rol de aplicación accede (incluye las sin RLS). */
  private static readonly TABLAS_APP = [
    'empresas',
    'certificados',
    'cafs',
    'documentos',
    'envios',
    'envio_documentos',
    'api_keys',
  ];

  private rolApp(): string {
    const rol = process.env.DATABASE_APP_USER?.trim() || 'api_sii_app';
    if (!/^[a-z_][a-z0-9_]{0,62}$/.test(rol)) {
      throw new Error(
        `DATABASE_APP_USER inválido (${rol}): use minúsculas, dígitos y _ (máx. 63 caracteres)`,
      );
    }
    return rol;
  }

  public async up(queryRunner: QueryRunner): Promise<void> {
    const rol = this.rolApp();
    const password = process.env.DATABASE_APP_PASSWORD;
    // Literal SQL seguro (standard_conforming_strings=on, el valor por defecto): solo hay que
    // duplicar las comillas simples. DDL no admite parámetros.
    const login = password ? `LOGIN PASSWORD '${password.replace(/'/g, "''")}'` : 'NOLOGIN';
    if (!password) {
      console.warn(
        `[RLS] DATABASE_APP_PASSWORD no está definida: el rol "${rol}" se crea/deja NOLOGIN. ` +
          'Defínala y vuelva a ejecutar (o use ALTER ROLE ... LOGIN PASSWORD) para que la API pueda conectarse con él.',
      );
    }

    // 1) Rol de aplicación (idempotente: si ya existe solo se normalizan sus atributos).
    const existe = (await queryRunner.query(`SELECT 1 FROM pg_roles WHERE rolname = $1`, [
      rol,
    ])) as unknown[];
    const atributos = 'NOSUPERUSER NOBYPASSRLS NOCREATEROLE NOCREATEDB NOREPLICATION';
    // Sentencias con la contraseña: van por la conexión cruda para que el logger de TypeORM (la CLI
    // registra todas las consultas) no las escriba en la consola/logs. Misma conexión y transacción.
    const sinLog = async (sql: string) => {
      const conexion = (await queryRunner.connect()) as { query(sql: string): Promise<unknown> };
      await conexion.query(sql);
    };
    if (existe.length === 0) {
      await sinLog(`CREATE ROLE "${rol}" ${atributos} ${login}`);
    } else {
      await sinLog(`ALTER ROLE "${rol}" ${atributos}${password ? ` ${login}` : ''}`);
    }

    // 2) Privilegios: solo DML sobre las tablas de negocio (sin DDL, sin la tabla de migraciones).
    await queryRunner.query(
      `GRANT CONNECT ON DATABASE "${await this.baseDeDatos(queryRunner)}" TO "${rol}"`,
    );
    await queryRunner.query(`GRANT USAGE ON SCHEMA public TO "${rol}"`);
    for (const t of RowLevelSecurity1795200000000.TABLAS_APP) {
      await queryRunner.query(`GRANT SELECT, INSERT, UPDATE, DELETE ON "${t}" TO "${rol}"`);
    }
    await queryRunner.query(`GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO "${rol}"`);
    // Tablas/secuencias que cree en el futuro quien ejecuta las migraciones (el dueño).
    await queryRunner.query(
      `ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO "${rol}"`,
    );
    await queryRunner.query(
      `ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT USAGE, SELECT ON SEQUENCES TO "${rol}"`,
    );

    // 3) Función del contexto. STABLE, SECURITY INVOKER (no se usa SECURITY DEFINER: saltaría RLS).
    //    Formato idéntico a normalizarRut(): "<rut sin ceros>-<DV en mayúscula>".
    //    current_setting(..., true) devuelve NULL (o '' tras una transacción que lo fijó): ambos
    //    equivalen a "sin contexto", y NULL/'' nunca coinciden con un RUT => fail-closed.
    await queryRunner.query(`
      CREATE FUNCTION app_rut_permitido(p_rut integer, p_dv text) RETURNS boolean
      LANGUAGE sql STABLE PARALLEL SAFE AS $$
        SELECT coalesce(current_setting('app.todas_empresas', true), '') = 'on'
            OR (p_rut::text || '-' || upper(p_dv)) = ANY (
                 string_to_array(coalesce(current_setting('app.empresas', true), ''), ',')
               )
      $$`);

    // 4) Políticas. empresas: por RUT. Hijas: empresa_id debe estar entre las empresas VISIBLES
    //    (la subconsulta queda filtrada por la política de empresas porque se ejecuta con los
    //    derechos del invocador). `IN (subconsulta no correlacionada)` se evalúa una sola vez por
    //    consulta (hashed subplan), no por fila.
    await queryRunner.query(`ALTER TABLE "empresas" ENABLE ROW LEVEL SECURITY`);
    await queryRunner.query(`ALTER TABLE "empresas" FORCE ROW LEVEL SECURITY`);
    await queryRunner.query(`
      CREATE POLICY aislamiento_empresa ON "empresas" FOR ALL
        USING (app_rut_permitido(rut, dv))
        WITH CHECK (app_rut_permitido(rut, dv))`);

    for (const t of RowLevelSecurity1795200000000.TABLAS_EMPRESA) {
      await queryRunner.query(`ALTER TABLE "${t}" ENABLE ROW LEVEL SECURITY`);
      await queryRunner.query(`ALTER TABLE "${t}" FORCE ROW LEVEL SECURITY`);
      // Los documentos, además, solo pueden referenciar un CAF visible (las FK se validan
      // saltándose RLS, así que sin esto se podría apuntar al CAF de otra empresa).
      const extra =
        t === 'documentos' ? ` AND (caf_id IS NULL OR caf_id IN (SELECT id FROM cafs))` : '';
      await queryRunner.query(`
        CREATE POLICY aislamiento_empresa ON "${t}" FOR ALL
          USING (empresa_id IN (SELECT id FROM empresas))
          WITH CHECK (empresa_id IN (SELECT id FROM empresas)${extra})`);
    }

    await queryRunner.query(`ALTER TABLE "envio_documentos" ENABLE ROW LEVEL SECURITY`);
    await queryRunner.query(`ALTER TABLE "envio_documentos" FORCE ROW LEVEL SECURITY`);
    await queryRunner.query(`
      CREATE POLICY aislamiento_empresa ON "envio_documentos" FOR ALL
        USING (envio_id IN (SELECT id FROM envios) AND documento_id IN (SELECT id FROM documentos))
        WITH CHECK (envio_id IN (SELECT id FROM envios) AND documento_id IN (SELECT id FROM documentos))`);

    // 5) Índices que usan las políticas (el resto ya tiene empresa_id como primera columna).
    await queryRunner.query(`CREATE INDEX "idx_envios_empresa" ON "envios" ("empresa_id")`);
    await queryRunner.query(
      `CREATE INDEX "idx_envio_documentos_documento" ON "envio_documentos" ("documento_id")`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    const rol = this.rolApp();
    await queryRunner.query(`DROP INDEX "idx_envio_documentos_documento"`);
    await queryRunner.query(`DROP INDEX "idx_envios_empresa"`);
    for (const t of [
      'envio_documentos',
      ...RowLevelSecurity1795200000000.TABLAS_EMPRESA,
      'empresas',
    ]) {
      await queryRunner.query(`DROP POLICY aislamiento_empresa ON "${t}"`);
      await queryRunner.query(`ALTER TABLE "${t}" NO FORCE ROW LEVEL SECURITY`);
      await queryRunner.query(`ALTER TABLE "${t}" DISABLE ROW LEVEL SECURITY`);
    }
    await queryRunner.query(`DROP FUNCTION app_rut_permitido(integer, text)`);
    await queryRunner.query(
      `ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE USAGE, SELECT ON SEQUENCES FROM "${rol}"`,
    );
    await queryRunner.query(
      `ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE SELECT, INSERT, UPDATE, DELETE ON TABLES FROM "${rol}"`,
    );
    await queryRunner.query(`REVOKE ALL ON ALL SEQUENCES IN SCHEMA public FROM "${rol}"`);
    await queryRunner.query(`REVOKE ALL ON ALL TABLES IN SCHEMA public FROM "${rol}"`);
    await queryRunner.query(`REVOKE USAGE ON SCHEMA public FROM "${rol}"`);
    // El rol (objeto de clúster) no se elimina: puede pertenecer a otras bases o tener sesiones.
  }

  private async baseDeDatos(queryRunner: QueryRunner): Promise<string> {
    const [fila] = (await queryRunner.query(`SELECT current_database() AS db`)) as Array<{
      db: string;
    }>;
    return fila.db.replace(/"/g, '""');
  }
}
