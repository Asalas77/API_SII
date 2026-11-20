import type { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Libros electrónicos (IECV de compras y ventas, y Libro de Guías de Despacho). Tabla nueva con
 * `empresa_id`: RLS activada y forzada con la política estándar por empresa (ver README de la base
 * de datos, "Agregar una tabla nueva"). Es solo DDL: no toca filas, así que no necesita contexto de RLS.
 * Los privilegios del rol de aplicación llegan por los `DEFAULT PRIVILEGES` de la migración
 * `RowLevelSecurity`.
 */
export class Libros1795400000000 implements MigrationInterface {
  name = 'Libros1795400000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE "libros" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "empresa_id" uuid NOT NULL,
        "tipo_operacion" character varying(6) NOT NULL,
        "tipo_libro" character varying(10) NOT NULL,
        "tipo_envio" character varying(7) NOT NULL,
        "periodo" character varying(7) NOT NULL,
        "folio_notificacion" bigint,
        "nro_segmento" integer,
        "ambiente_sii" "public"."ambiente_sii_enum" NOT NULL,
        "xml_libro" text NOT NULL,
        "resumen" jsonb,
        "cantidad_documentos" integer NOT NULL DEFAULT 0,
        "track_id" character varying(20),
        "estado" character varying(10),
        "glosa_estado" character varying(200),
        "respuesta" jsonb,
        "intentos" integer NOT NULL DEFAULT 0,
        "enviado_en" TIMESTAMP WITH TIME ZONE,
        "consultado_en" TIMESTAMP WITH TIME ZONE,
        "creado_en" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        "actualizado_en" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        CONSTRAINT "pk_libros" PRIMARY KEY ("id"),
        CONSTRAINT "chk_libros_tipo_operacion" CHECK ("tipo_operacion" IN ('VENTA', 'COMPRA', 'GUIA')),
        CONSTRAINT "fk_libros_empresa" FOREIGN KEY ("empresa_id") REFERENCES "empresas"("id") ON DELETE RESTRICT ON UPDATE NO ACTION
      )`);
    await queryRunner.query(`CREATE INDEX "idx_libros_empresa_periodo" ON "libros" ("empresa_id", "periodo")`);
    await queryRunner.query(`ALTER TABLE "libros" ENABLE ROW LEVEL SECURITY`);
    await queryRunner.query(`ALTER TABLE "libros" FORCE ROW LEVEL SECURITY`);
    await queryRunner.query(`
      CREATE POLICY aislamiento_empresa ON "libros" FOR ALL
        USING (empresa_id IN (SELECT id FROM empresas))
        WITH CHECK (empresa_id IN (SELECT id FROM empresas))`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP POLICY aislamiento_empresa ON "libros"`);
    await queryRunner.query(`DROP TABLE "libros"`);
  }
}
