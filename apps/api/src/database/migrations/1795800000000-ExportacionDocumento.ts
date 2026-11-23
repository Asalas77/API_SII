import type { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Documentos de exportación (110 factura, 111 nota de débito, 112 nota de crédito): moneda de la operación,
 * tipo de cambio y monto total en esa moneda. Las columnas de montos existentes (`monto_exento`, `monto_total`)
 * conservan el equivalente en pesos chilenos (enteros), que es lo que usan el libro de ventas y la consulta de
 * estado al SII. Solo DDL: no toca filas ni políticas RLS (la tabla `documentos` ya las tiene forzadas).
 */
export class ExportacionDocumento1795800000000 implements MigrationInterface {
  name = 'ExportacionDocumento1795800000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "documentos" ADD "moneda" character varying(15)`);
    await queryRunner.query(`ALTER TABLE "documentos" ADD "tipo_cambio" numeric(10,4)`);
    await queryRunner.query(`ALTER TABLE "documentos" ADD "monto_moneda" numeric(18,4)`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "documentos" DROP COLUMN "monto_moneda"`);
    await queryRunner.query(`ALTER TABLE "documentos" DROP COLUMN "tipo_cambio"`);
    await queryRunner.query(`ALTER TABLE "documentos" DROP COLUMN "moneda"`);
  }
}
