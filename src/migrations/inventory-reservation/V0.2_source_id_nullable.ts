import { MigrationInterface, QueryRunner } from 'typeorm';
import { assertDestructiveDownAllowed } from '../../config/destructive-down.js';

// Una reserva manual (la que aparta el administrador desde Inventario, sourceType
// MANUAL_ADJUSTMENT) no nace de ningún documento: no tiene sourceId. Las que sí nacen de uno (una
// venta, un pedido) lo siguen exigiendo — eso lo comprueba InventoryReservationService.create.
export class InventoryReservationSourceIdNullable1791000000002 implements MigrationInterface {
  name = 'InventoryReservationSourceIdNullable1791000000002';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "inventory_reservations" ALTER COLUMN "sourceId" DROP NOT NULL`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    assertDestructiveDownAllowed(this.name);
    // Las reservas manuales no caben en el esquema viejo: se borran (es lo apartado, no el stock).
    await queryRunner.query(`DELETE FROM "inventory_reservations" WHERE "sourceId" IS NULL`);
    await queryRunner.query(`ALTER TABLE "inventory_reservations" ALTER COLUMN "sourceId" SET NOT NULL`);
  }
}
