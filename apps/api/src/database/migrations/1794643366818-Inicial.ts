import type { MigrationInterface, QueryRunner } from 'typeorm';

export class Inicial1794643366818 implements MigrationInterface {
  name = 'Inicial1794643366818';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TYPE "public"."ambiente_sii_enum" AS ENUM('certificacion', 'produccion')`,
    );
    await queryRunner.query(
      `CREATE TABLE "empresas" ("id" uuid NOT NULL DEFAULT gen_random_uuid(), "rut" integer NOT NULL, "dv" character(1) NOT NULL, "razon_social" character varying(100) NOT NULL, "giro" character varying(80) NOT NULL, "actecos" integer array NOT NULL, "direccion" character varying(70) NOT NULL, "comuna" character varying(20) NOT NULL, "ciudad" character varying(20) NOT NULL, "codigo_sucursal_sii" character varying(20), "telefono" character varying(20), "correo_intercambio" character varying(80), "nro_resolucion_sii" integer, "fecha_resolucion_sii" date, "ambiente_sii" "public"."ambiente_sii_enum" NOT NULL DEFAULT 'certificacion', "activa" boolean NOT NULL DEFAULT true, "creado_en" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "actualizado_en" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "uq_empresas_rut" UNIQUE ("rut"), CONSTRAINT "PK_ce7b122b37c6499bfd6520873e1" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE TABLE "certificados" ("id" uuid NOT NULL DEFAULT gen_random_uuid(), "empresa_id" uuid NOT NULL, "rut_firmante" integer NOT NULL, "dv_firmante" character(1) NOT NULL, "nombre_firmante" character varying(100) NOT NULL, "pfx_cifrado" bytea NOT NULL, "password_cifrada" bytea NOT NULL, "valido_desde" TIMESTAMP WITH TIME ZONE NOT NULL, "valido_hasta" TIMESTAMP WITH TIME ZONE NOT NULL, "activo" boolean NOT NULL DEFAULT true, "creado_en" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "PK_e9b232ca7a16db08667f021708f" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "idx_certificados_empresa_activo" ON "certificados"  ("empresa_id", "activo") `,
    );
    await queryRunner.query(
      `CREATE TABLE "cafs" ("id" uuid NOT NULL DEFAULT gen_random_uuid(), "empresa_id" uuid NOT NULL, "tipo_dte" smallint NOT NULL, "folio_desde" integer NOT NULL, "folio_hasta" integer NOT NULL, "folio_siguiente" integer NOT NULL, "fecha_autorizacion" date NOT NULL, "fecha_vencimiento" date, "xml" text NOT NULL, "agotado" boolean NOT NULL DEFAULT false, "anulado" boolean NOT NULL DEFAULT false, "creado_en" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "uq_cafs_empresa_tipo_desde" UNIQUE ("empresa_id", "tipo_dte", "folio_desde"), CONSTRAINT "PK_e035907e861fc2dbd21053c1444" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "idx_cafs_empresa_tipo_agotado" ON "cafs"  ("empresa_id", "tipo_dte", "agotado") `,
    );
    await queryRunner.query(
      `CREATE TYPE "public"."estado_documento_enum" AS ENUM('emitido', 'encolado', 'enviado', 'aceptado', 'aceptado_con_reparos', 'rechazado', 'anulado')`,
    );
    await queryRunner.query(
      `CREATE TABLE "documentos" ("id" uuid NOT NULL DEFAULT gen_random_uuid(), "empresa_id" uuid NOT NULL, "caf_id" uuid, "tipo_dte" smallint NOT NULL, "folio" integer NOT NULL, "fecha_emision" date NOT NULL, "rut_receptor" integer, "dv_receptor" character(1), "razon_social_receptor" character varying(100), "monto_neto" bigint, "monto_exento" bigint, "iva" bigint, "monto_total" bigint NOT NULL, "estado" "public"."estado_documento_enum" NOT NULL, "track_id" character varying(20), "xml_firmado" text NOT NULL, "ted" text NOT NULL, "reparos" jsonb, "clave_idempotencia" character varying(100), "creado_en" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "actualizado_en" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "uq_documentos_empresa_tipo_folio" UNIQUE ("empresa_id", "tipo_dte", "folio"), CONSTRAINT "PK_30b7ee230a352e7582842d1dc02" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "idx_documentos_empresa_estado" ON "documentos"  ("empresa_id", "estado") `,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "uq_documentos_empresa_idempotencia" ON "documentos"  ("empresa_id", "clave_idempotencia") WHERE "clave_idempotencia" IS NOT NULL`,
    );
    await queryRunner.query(
      `CREATE TYPE "public"."canal_envio_enum" AS ENUM('dte', 'boleta')`,
    );
    await queryRunner.query(
      `CREATE TABLE "envios" ("id" uuid NOT NULL DEFAULT gen_random_uuid(), "empresa_id" uuid NOT NULL, "canal" "public"."canal_envio_enum" NOT NULL, "ambiente_sii" "public"."ambiente_sii_enum" NOT NULL, "track_id" character varying(20), "estado" character varying(10), "glosa_estado" character varying(200), "xml_envio" text, "respuesta" jsonb, "intentos" integer NOT NULL DEFAULT '0', "enviado_en" TIMESTAMP WITH TIME ZONE, "consultado_en" TIMESTAMP WITH TIME ZONE, "creado_en" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "PK_c3e39ce11196eaf350b50652227" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE TABLE "envio_documentos" ("envio_id" uuid NOT NULL, "documento_id" uuid NOT NULL, "estado" character varying(10), "glosa" character varying(200), CONSTRAINT "PK_d821a57f51b6ec9cb55ad2abeec" PRIMARY KEY ("envio_id", "documento_id"))`,
    );
    await queryRunner.query(
      `ALTER TABLE "certificados" ADD CONSTRAINT "FK_e487b43a410c64fa0d15b464cc1" FOREIGN KEY ("empresa_id") REFERENCES "empresas"("id") ON DELETE RESTRICT ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "cafs" ADD CONSTRAINT "FK_4bfaad9ba2bf95634ecffd9c6b9" FOREIGN KEY ("empresa_id") REFERENCES "empresas"("id") ON DELETE RESTRICT ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "documentos" ADD CONSTRAINT "FK_8a73e530b14e408a12cb2e8ce1e" FOREIGN KEY ("empresa_id") REFERENCES "empresas"("id") ON DELETE RESTRICT ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "documentos" ADD CONSTRAINT "FK_f940aa42c0d20bcc7de65e6efdb" FOREIGN KEY ("caf_id") REFERENCES "cafs"("id") ON DELETE RESTRICT ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "envios" ADD CONSTRAINT "FK_efd21cd85cb8e42abf6c8d209cc" FOREIGN KEY ("empresa_id") REFERENCES "empresas"("id") ON DELETE RESTRICT ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "envio_documentos" ADD CONSTRAINT "FK_3c3b1731324bb5092dbd80f67a5" FOREIGN KEY ("envio_id") REFERENCES "envios"("id") ON DELETE RESTRICT ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "envio_documentos" ADD CONSTRAINT "FK_73fb0311ea460a027e716856d5c" FOREIGN KEY ("documento_id") REFERENCES "documentos"("id") ON DELETE RESTRICT ON UPDATE NO ACTION`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "envio_documentos" DROP CONSTRAINT "FK_73fb0311ea460a027e716856d5c"`,
    );
    await queryRunner.query(
      `ALTER TABLE "envio_documentos" DROP CONSTRAINT "FK_3c3b1731324bb5092dbd80f67a5"`,
    );
    await queryRunner.query(
      `ALTER TABLE "envios" DROP CONSTRAINT "FK_efd21cd85cb8e42abf6c8d209cc"`,
    );
    await queryRunner.query(
      `ALTER TABLE "documentos" DROP CONSTRAINT "FK_f940aa42c0d20bcc7de65e6efdb"`,
    );
    await queryRunner.query(
      `ALTER TABLE "documentos" DROP CONSTRAINT "FK_8a73e530b14e408a12cb2e8ce1e"`,
    );
    await queryRunner.query(
      `ALTER TABLE "cafs" DROP CONSTRAINT "FK_4bfaad9ba2bf95634ecffd9c6b9"`,
    );
    await queryRunner.query(
      `ALTER TABLE "certificados" DROP CONSTRAINT "FK_e487b43a410c64fa0d15b464cc1"`,
    );
    await queryRunner.query(`DROP TABLE "envio_documentos"`);
    await queryRunner.query(`DROP TABLE "envios"`);
    await queryRunner.query(`DROP TYPE "public"."canal_envio_enum"`);
    await queryRunner.query(
      `DROP INDEX "public"."uq_documentos_empresa_idempotencia"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."idx_documentos_empresa_estado"`,
    );
    await queryRunner.query(`DROP TABLE "documentos"`);
    await queryRunner.query(`DROP TYPE "public"."estado_documento_enum"`);
    await queryRunner.query(
      `DROP INDEX "public"."idx_cafs_empresa_tipo_agotado"`,
    );
    await queryRunner.query(`DROP TABLE "cafs"`);
    await queryRunner.query(
      `DROP INDEX "public"."idx_certificados_empresa_activo"`,
    );
    await queryRunner.query(`DROP TABLE "certificados"`);
    await queryRunner.query(`DROP TABLE "empresas"`);
    await queryRunner.query(`DROP TYPE "public"."ambiente_sii_enum"`);
  }
}
