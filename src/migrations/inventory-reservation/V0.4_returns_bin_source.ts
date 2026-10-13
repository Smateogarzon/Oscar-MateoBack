import { MigrationInterface, QueryRunner } from 'typeorm';
import { assertDestructiveDownAllowed } from '../../config/destructive-down.js';

// El cajón de devoluciones de cada tienda: lo que el cliente no compró, lo que se cambió, lo que caja
// quitó de una venta y lo que se devolvió de una venta cobrada queda en el STOCK de la tienda,
// apartado a nombre del cajón (sourceType RETURNS_BIN), hasta que el administrador lo manda a bodega
// en una RE. Así se sigue viendo en la tienda (Inventario) y nadie lo vende.
export class AddReturnsBinSourceType1791900000030 implements MigrationInterface {
  name = 'AddReturnsBinSourceType1791900000030';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TYPE "public"."inventory_source_type" ADD VALUE IF NOT EXISTS 'RETURNS_BIN'`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    assertDestructiveDownAllowed(this.name);
    // Lo que estaba en el cajón deja de estar apartado (sigue en el STOCK de la tienda).
    await queryRunner.query(`DELETE FROM "inventory_reservations" WHERE "sourceType" = 'RETURNS_BIN'`);
    await queryRunner.query(`ALTER TYPE "public"."inventory_source_type" RENAME TO "inventory_source_type_old"`);
    await queryRunner.query(
      `CREATE TYPE "public"."inventory_source_type" AS ENUM('SALE', 'SALE_RETURN', 'PURCHASE_ORDER', 'TRANSFER_REQUEST', 'MANUAL_ADJUSTMENT', 'RUNNER_ASSIGNMENT')`,
    );
    for (const table of ['inventory_reservations', 'inventory_movements']) {
      await queryRunner.query(
        `ALTER TABLE "${table}" ALTER COLUMN "sourceType" TYPE "public"."inventory_source_type" USING "sourceType"::"text"::"public"."inventory_source_type"`,
      );
    }
    await queryRunner.query(`DROP TYPE "public"."inventory_source_type_old"`);
  }
}
