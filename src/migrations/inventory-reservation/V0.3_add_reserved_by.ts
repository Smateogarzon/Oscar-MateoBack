import { MigrationInterface, QueryRunner } from 'typeorm';
import { assertDestructiveDownAllowed } from '../../config/destructive-down.js';

// Quién tiene apartado algo. Antes una reserva no decía de quién era: el segundo vendedor que buscaba
// el último par no podía saber que ya lo había tomado un compañero. Nulo en las reservas que ya
// existían (nadie registró quién las hizo) y en las que nazcan de un documento sin usuario.
export class InventoryReservationAddReservedBy1791000000003 implements MigrationInterface {
  name = 'InventoryReservationAddReservedBy1791000000003';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "inventory_reservations" ADD COLUMN "reservedBy" uuid`);
    await queryRunner.query(
      `ALTER TABLE "inventory_reservations"
         ADD CONSTRAINT "FK_inventory_reservations_reservedBy"
         FOREIGN KEY ("reservedBy") REFERENCES "users"("id") ON DELETE SET NULL`,
    );
    // Las reservas de una venta en curso se buscan siempre por su documento (soltar lo que apartaba
    // una venta al cancelarla, al cobrarla o al descartar sus borradores).
    await queryRunner.query(
      `CREATE INDEX "IDX_inventory_reservations_source" ON "inventory_reservations" ("sourceType", "sourceId")`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    assertDestructiveDownAllowed(this.name);
    await queryRunner.query(`DROP INDEX "IDX_inventory_reservations_source"`);
    await queryRunner.query(
      `ALTER TABLE "inventory_reservations" DROP CONSTRAINT "FK_inventory_reservations_reservedBy"`,
    );
    await queryRunner.query(`ALTER TABLE "inventory_reservations" DROP COLUMN "reservedBy"`);
  }
}
