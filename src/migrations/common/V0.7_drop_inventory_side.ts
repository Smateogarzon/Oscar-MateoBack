import { MigrationInterface, QueryRunner } from 'typeorm';
import { assertDestructiveDownAllowed } from '../../config/destructive-down.js';

// El "lado del par" nunca llegó a usarse: cada movimiento, balanza y reserva siempre fue PAIR (ver
// sale-payment.service.ts y sale-return.service.ts, y todos los formularios del frontend, que lo
// hardcodeaban). Se quita la columna de las tres tablas que la tenían y el tipo que creó
// V0.5_add_common. En inventory_balances el unique (productVariantId, inventoryLocationId, side)
// pasa a ser unique (productVariantId, inventoryLocationId) sin más, que es justo lo que ya
// garantizaba en la práctica al no haber más de un side; en inventory_reservations el índice
// equivalente queda igual, solo sin esa columna.
export class DropInventorySide1791200000000 implements MigrationInterface {
  name = 'DropInventorySide1791200000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX "public"."IDX_c93b1932ba4077b4e4e504210e"`);
    await queryRunner.query(`ALTER TABLE "inventory_balances" DROP COLUMN "side"`);
    await queryRunner.query(
      `CREATE UNIQUE INDEX "IDX_inventory_balances_variant_location" ON "inventory_balances" ("productVariantId", "inventoryLocationId")`,
    );

    await queryRunner.query(`ALTER TABLE "inventory_movements" DROP COLUMN "side"`);

    await queryRunner.query(`DROP INDEX "public"."IDX_51af71893c9bc10e86b8d2836b"`);
    await queryRunner.query(`ALTER TABLE "inventory_reservations" DROP COLUMN "side"`);
    await queryRunner.query(
      `CREATE INDEX "IDX_inventory_reservations_variant_location" ON "inventory_reservations" ("productVariantId", "inventoryLocationId")`,
    );

    await queryRunner.query(`DROP TYPE "public"."inventory_side"`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    assertDestructiveDownAllowed(this.name);
    await queryRunner.query(`CREATE TYPE "public"."inventory_side" AS ENUM('PAIR', 'LEFT', 'RIGHT')`);

    await queryRunner.query(`DROP INDEX "public"."IDX_inventory_balances_variant_location"`);
    await queryRunner.query(
      `ALTER TABLE "inventory_balances" ADD COLUMN "side" "public"."inventory_side" NOT NULL DEFAULT 'PAIR'`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "IDX_c93b1932ba4077b4e4e504210e" ON "inventory_balances" ("productVariantId", "inventoryLocationId", "side")`,
    );

    await queryRunner.query(
      `ALTER TABLE "inventory_movements" ADD COLUMN "side" "public"."inventory_side" NOT NULL DEFAULT 'PAIR'`,
    );
    await queryRunner.query(`ALTER TABLE "inventory_movements" ALTER COLUMN "side" DROP DEFAULT`);

    await queryRunner.query(`DROP INDEX "public"."IDX_inventory_reservations_variant_location"`);
    await queryRunner.query(
      `ALTER TABLE "inventory_reservations" ADD COLUMN "side" "public"."inventory_side" NOT NULL DEFAULT 'PAIR'`,
    );
    await queryRunner.query(`ALTER TABLE "inventory_reservations" ALTER COLUMN "side" DROP DEFAULT`);
    await queryRunner.query(
      `CREATE INDEX "IDX_51af71893c9bc10e86b8d2836b" ON "inventory_reservations" ("productVariantId", "inventoryLocationId", "side")`,
    );
  }
}
