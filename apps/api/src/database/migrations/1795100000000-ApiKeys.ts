import type { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Autenticación por API keys: la tabla guarda solo el hash SHA-256 de la clave (nunca el secreto),
 * su prefijo visible, permisos atómicos y las empresas (RUT normalizados) a las que da acceso.
 */
export class ApiKeys1795100000000 implements MigrationInterface {
  name = 'ApiKeys1795100000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TABLE "api_keys" ("id" uuid NOT NULL DEFAULT gen_random_uuid(), "nombre" character varying(100) NOT NULL, "prefijo" character varying(16) NOT NULL, "hash_clave" character(64) NOT NULL, "permisos" text array NOT NULL, "empresas" text array NOT NULL DEFAULT '{}', "todas_las_empresas" boolean NOT NULL DEFAULT false, "activa" boolean NOT NULL DEFAULT true, "expira_en" TIMESTAMP WITH TIME ZONE, "ultimo_uso_en" TIMESTAMP WITH TIME ZONE, "creada_en" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "revocada_en" TIMESTAMP WITH TIME ZONE, CONSTRAINT "uq_api_keys_prefijo" UNIQUE ("prefijo"), CONSTRAINT "PK_api_keys_id" PRIMARY KEY ("id"))`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE "api_keys"`);
  }
}
