import type { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Estado de cada documento según el SII (`getEstDte` para DTE, `GET boleta.electronica/.../estado`
 * para boletas): código devuelto, glosa, instante de la consulta y un resumen de la respuesta.
 * Solo DDL: no toca filas, así que no necesita contexto de RLS (la tabla `documentos` ya tiene RLS
 * forzada y el rol de aplicación tiene DML a nivel de tabla).
 */
export class EstadoSiiDocumento1795500000000 implements MigrationInterface {
  name = 'EstadoSiiDocumento1795500000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "documentos" ADD "estado_sii" character varying(10)`);
    await queryRunner.query(`ALTER TABLE "documentos" ADD "glosa_sii" text`);
    await queryRunner.query(`ALTER TABLE "documentos" ADD "consultado_sii_en" TIMESTAMP WITH TIME ZONE`);
    await queryRunner.query(`ALTER TABLE "documentos" ADD "respuesta_estado_sii" jsonb`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "documentos" DROP COLUMN "respuesta_estado_sii"`);
    await queryRunner.query(`ALTER TABLE "documentos" DROP COLUMN "consultado_sii_en"`);
    await queryRunner.query(`ALTER TABLE "documentos" DROP COLUMN "glosa_sii"`);
    await queryRunner.query(`ALTER TABLE "documentos" DROP COLUMN "estado_sii"`);
  }
}
