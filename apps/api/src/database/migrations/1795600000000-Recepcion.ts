import type { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Recepción de DTE de proveedores (intercambio de información entre contribuyentes).
 * - `envios_recibidos`: cada `EnvioDTE` recibido, con el XML original byte a byte, su hash SHA-256 (único por
 *   empresa: deduplicación) y el acuse `RecepcionEnvio` generado.
 * - `dte_recibidos`: cada DTE aceptado en recepción, con su XML individual, montos, estado comercial,
 *   plazo de reclamo (Ley 20.956) y el resultado del registro ante el SII.
 * - `buzones_correo`: configuración IMAP/SMTP por empresa (contraseñas cifradas con `CifradoService`).
 * Todas con `empresa_id`: RLS activada y forzada con la política estándar (ver README de la base de datos).
 * Solo DDL: no toca filas, así que no necesita contexto de RLS. Los privilegios del rol de aplicación llegan
 * por los `DEFAULT PRIVILEGES` de `RowLevelSecurity` (tablas y secuencias).
 */
export class Recepcion1795600000000 implements MigrationInterface {
  name = 'Recepcion1795600000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // CodEnvio e IdRespuesta de las respuestas de intercambio: enteros positivos de hasta 10 dígitos.
    await queryRunner.query(`CREATE SEQUENCE "seq_codigo_envio_recibido" AS integer START 1`);
    await queryRunner.query(`CREATE SEQUENCE "seq_id_respuesta_intercambio" AS integer START 1`);

    await queryRunner.query(`
      CREATE TABLE "envios_recibidos" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "empresa_id" uuid NOT NULL,
        "origen" character varying(10) NOT NULL,
        "remitente" character varying(254),
        "nombre_archivo" character varying(200),
        "xml" bytea NOT NULL,
        "hash_sha256" character(64) NOT NULL,
        "codigo_envio" integer NOT NULL DEFAULT nextval('seq_codigo_envio_recibido'),
        "rut_emisor" character varying(12),
        "rut_envia" character varying(12),
        "fecha_firma" TIMESTAMP WITH TIME ZONE,
        "estado_recepcion" smallint NOT NULL,
        "glosa" character varying(300) NOT NULL,
        "xml_recepcion_envio" text,
        "resumen_dtes" jsonb,
        "respuesta_enviada_en" TIMESTAMP WITH TIME ZONE,
        "recibido_en" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        "creado_en" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        CONSTRAINT "pk_envios_recibidos" PRIMARY KEY ("id"),
        CONSTRAINT "uq_envios_recibidos_hash" UNIQUE ("empresa_id", "hash_sha256"),
        CONSTRAINT "chk_envios_recibidos_origen" CHECK ("origen" IN ('upload', 'correo')),
        CONSTRAINT "fk_envios_recibidos_empresa" FOREIGN KEY ("empresa_id") REFERENCES "empresas"("id") ON DELETE RESTRICT ON UPDATE NO ACTION
      )`);
    await queryRunner.query(
      `CREATE INDEX "idx_envios_recibidos_empresa_fecha" ON "envios_recibidos" ("empresa_id", "recibido_en")`,
    );

    await queryRunner.query(`
      CREATE TABLE "dte_recibidos" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "empresa_id" uuid NOT NULL,
        "envio_recibido_id" uuid NOT NULL,
        "indice" integer NOT NULL DEFAULT 0,
        "tipo_dte" smallint NOT NULL,
        "folio" bigint NOT NULL,
        "rut_emisor" integer NOT NULL,
        "dv_emisor" character(1) NOT NULL,
        "razon_social_emisor" character varying(100),
        "fecha_emision" date NOT NULL,
        "monto_neto" bigint,
        "monto_exento" bigint,
        "iva" bigint,
        "monto_total" bigint NOT NULL,
        "otros_impuestos" jsonb,
        "xml" text NOT NULL,
        "estado_recepcion_dte" smallint NOT NULL DEFAULT 0,
        "estado_comercial" character varying(25) NOT NULL DEFAULT 'pendiente',
        "glosa" text,
        "respondido_en" TIMESTAMP WITH TIME ZONE,
        "xml_resultado_dte" text,
        "xml_envio_recibos" text,
        "plazo_reclamo_hasta" TIMESTAMP WITH TIME ZONE NOT NULL,
        "plazo_confirmado_sii" boolean NOT NULL DEFAULT false,
        "fecha_recepcion_sii" TIMESTAMP WITH TIME ZONE,
        "acuse_recibo_mercaderias" boolean NOT NULL DEFAULT false,
        "registro_sii" jsonb,
        "creado_en" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        "actualizado_en" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        CONSTRAINT "pk_dte_recibidos" PRIMARY KEY ("id"),
        CONSTRAINT "uq_dte_recibidos_documento" UNIQUE ("empresa_id", "rut_emisor", "tipo_dte", "folio"),
        CONSTRAINT "chk_dte_recibidos_estado_comercial" CHECK ("estado_comercial" IN ('pendiente', 'aceptado', 'aceptado_con_reparos', 'rechazado')),
        CONSTRAINT "fk_dte_recibidos_empresa" FOREIGN KEY ("empresa_id") REFERENCES "empresas"("id") ON DELETE RESTRICT ON UPDATE NO ACTION,
        CONSTRAINT "fk_dte_recibidos_envio" FOREIGN KEY ("envio_recibido_id") REFERENCES "envios_recibidos"("id") ON DELETE RESTRICT ON UPDATE NO ACTION
      )`);
    await queryRunner.query(
      `CREATE INDEX "idx_dte_recibidos_empresa_fecha" ON "dte_recibidos" ("empresa_id", "fecha_emision")`,
    );
    await queryRunner.query(`CREATE INDEX "idx_dte_recibidos_envio" ON "dte_recibidos" ("envio_recibido_id")`);

    await queryRunner.query(`
      CREATE TABLE "buzones_correo" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "empresa_id" uuid NOT NULL,
        "activo" boolean NOT NULL DEFAULT true,
        "imap_host" character varying(200) NOT NULL,
        "imap_puerto" integer NOT NULL DEFAULT 993,
        "imap_seguro" boolean NOT NULL DEFAULT true,
        "usuario" character varying(200) NOT NULL,
        "password_cifrada" bytea NOT NULL,
        "carpeta" character varying(200) NOT NULL DEFAULT 'INBOX',
        "carpeta_procesados" character varying(200),
        "smtp_host" character varying(200),
        "smtp_puerto" integer,
        "smtp_seguro" boolean NOT NULL DEFAULT false,
        "smtp_usuario" character varying(200),
        "smtp_password_cifrada" bytea,
        "smtp_remitente" character varying(254),
        "intervalo_segundos" integer NOT NULL DEFAULT 300,
        "ultimo_sondeo_en" TIMESTAMP WITH TIME ZONE,
        "ultimo_error" text,
        "creado_en" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        "actualizado_en" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        CONSTRAINT "pk_buzones_correo" PRIMARY KEY ("id"),
        CONSTRAINT "uq_buzones_correo_empresa" UNIQUE ("empresa_id"),
        CONSTRAINT "fk_buzones_correo_empresa" FOREIGN KEY ("empresa_id") REFERENCES "empresas"("id") ON DELETE RESTRICT ON UPDATE NO ACTION
      )`);

    for (const tabla of ['envios_recibidos', 'dte_recibidos', 'buzones_correo']) {
      await queryRunner.query(`ALTER TABLE "${tabla}" ENABLE ROW LEVEL SECURITY`);
      await queryRunner.query(`ALTER TABLE "${tabla}" FORCE ROW LEVEL SECURITY`);
      await queryRunner.query(`
        CREATE POLICY aislamiento_empresa ON "${tabla}" FOR ALL
          USING (empresa_id IN (SELECT id FROM empresas))
          WITH CHECK (empresa_id IN (SELECT id FROM empresas))`);
    }
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    for (const tabla of ['buzones_correo', 'dte_recibidos', 'envios_recibidos']) {
      await queryRunner.query(`DROP POLICY aislamiento_empresa ON "${tabla}"`);
      await queryRunner.query(`DROP TABLE "${tabla}"`);
    }
    await queryRunner.query(`DROP SEQUENCE "seq_id_respuesta_intercambio"`);
    await queryRunner.query(`DROP SEQUENCE "seq_codigo_envio_recibido"`);
  }
}
