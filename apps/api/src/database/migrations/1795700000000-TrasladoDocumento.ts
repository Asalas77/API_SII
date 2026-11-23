import type { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Res. Ex. SII 144/2026 (guías y facturas que amparan traslado): resumen del traslado de cada documento
 * (`traslado`, jsonb con los datos normalizados y la solicitud original) y la marca `traslado_pendiente`
 * (algún dato quedó "Diferido" o "Sin Dato" y falta complementarlo con una guía posterior, GDT o ATT).
 * Solo DDL: no toca filas ni políticas RLS (la tabla `documentos` ya las tiene forzadas).
 */
export class TrasladoDocumento1795700000000 implements MigrationInterface {
  name = 'TrasladoDocumento1795700000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "documentos" ADD "traslado" jsonb`);
    await queryRunner.query(`ALTER TABLE "documentos" ADD "traslado_pendiente" boolean NOT NULL DEFAULT false`);
    await queryRunner.query(
      `CREATE INDEX "idx_documentos_empresa_traslado_pendiente" ON "documentos" ("empresa_id") WHERE "traslado_pendiente"`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX "idx_documentos_empresa_traslado_pendiente"`);
    await queryRunner.query(`ALTER TABLE "documentos" DROP COLUMN "traslado_pendiente"`);
    await queryRunner.query(`ALTER TABLE "documentos" DROP COLUMN "traslado"`);
  }
}
