import type { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Opciones de la representación impresa por empresa: unidad del SII, plantilla de URL de verificación
 * y logo (PNG/JPEG en `bytea`). Solo DDL: no toca filas, así que no necesita contexto de RLS. El rol de
 * aplicación ya tiene `SELECT/INSERT/UPDATE/DELETE` a nivel de tabla `empresas` (RowLevelSecurity), que
 * cubre las columnas nuevas.
 */
export class OpcionesPdfEmpresa1795300000000 implements MigrationInterface {
  name = 'OpcionesPdfEmpresa1795300000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "empresas" ADD "unidad_sii" character varying(80)`);
    await queryRunner.query(`ALTER TABLE "empresas" ADD "url_verificacion" character varying(300)`);
    await queryRunner.query(`ALTER TABLE "empresas" ADD "logo" bytea`);
    await queryRunner.query(`ALTER TABLE "empresas" ADD "logo_tipo" character varying(20)`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "empresas" DROP COLUMN "logo_tipo"`);
    await queryRunner.query(`ALTER TABLE "empresas" DROP COLUMN "logo"`);
    await queryRunner.query(`ALTER TABLE "empresas" DROP COLUMN "url_verificacion"`);
    await queryRunner.query(`ALTER TABLE "empresas" DROP COLUMN "unidad_sii"`);
  }
}
