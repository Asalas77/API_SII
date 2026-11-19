import type { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * WP9: datos para emitir y certificar.
 *
 * - `cafs.xml_cifrado` (AES-256-GCM, `CifradoService`): el CAF contiene la clave privada RSASK y no
 *   debe quedar en claro. `cafs.xml` pasa a ser NULLABLE y queda DEPRECADO: las filas anteriores
 *   conservan su XML en claro hasta que `FoliosService` las lee (migración perezosa: cifra y deja
 *   `xml` en NULL) o se invoca `FoliosService.cifrarCafsHeredados()`. No se cifra aquí porque la
 *   clave maestra vive en la aplicación, no en la base.
 * - `documentos.huella_solicitud`: SHA-256 del cuerpo de emisión, para detectar el reuso de una
 *   `Idempotency-Key` con otro cuerpo (409).
 * - `documentos.origen`: metadato opcional del sistema de origen (ERP).
 * - `empresas.rut_proveedor_software` / `dv_proveedor_software`: proveedor de software (RUTProvSW).
 */
export class CifrarCafYEmision1794989345328 implements MigrationInterface {
  name = 'CifrarCafYEmision1794989345328';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "cafs" ADD "xml_cifrado" bytea`);
    await queryRunner.query(`ALTER TABLE "cafs" ALTER COLUMN "xml" DROP NOT NULL`);
    await queryRunner.query(`ALTER TABLE "documentos" ADD "huella_solicitud" character varying(64)`);
    await queryRunner.query(`ALTER TABLE "documentos" ADD "origen" jsonb`);
    await queryRunner.query(`ALTER TABLE "empresas" ADD "rut_proveedor_software" integer`);
    await queryRunner.query(`ALTER TABLE "empresas" ADD "dv_proveedor_software" character(1)`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "empresas" DROP COLUMN "dv_proveedor_software"`);
    await queryRunner.query(`ALTER TABLE "empresas" DROP COLUMN "rut_proveedor_software"`);
    await queryRunner.query(`ALTER TABLE "documentos" DROP COLUMN "origen"`);
    await queryRunner.query(`ALTER TABLE "documentos" DROP COLUMN "huella_solicitud"`);
    // Solo es posible si ningún CAF quedó únicamente cifrado (xml NULL): reviértase antes de borrar datos.
    await queryRunner.query(`ALTER TABLE "cafs" ALTER COLUMN "xml" SET NOT NULL`);
    await queryRunner.query(`ALTER TABLE "cafs" DROP COLUMN "xml_cifrado"`);
  }
}
