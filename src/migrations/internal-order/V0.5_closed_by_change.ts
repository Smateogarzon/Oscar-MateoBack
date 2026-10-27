import { MigrationInterface, QueryRunner } from 'typeorm';
import { assertDestructiveDownAllowed } from '../../config/destructive-down.js';

// El cambio de pedido se cobra en la sub-orden, no en la original (acordado con el usuario,
// 2026-10-08). Antes la sub-orden se fundía en la original y moría en MERGED_INTO_PARENT; ahora es
// al revés: la sub-orden recibe lo que el cliente se queda y sigue hasta el pago, y la original
// queda TERMINADA SIN COBRO en el estado nuevo CLOSED_BY_CHANGE. MERGED_INTO_PARENT se conserva
// para las órdenes que ya cerraron con la regla anterior.
export class InternalOrderClosedByChange1791900000022 implements MigrationInterface {
  name = 'InternalOrderClosedByChange1791900000022';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await this.retype(queryRunner, `'NEW', 'ACCEPTED_BY_WAREHOUSE', 'PACKING', 'READY_FOR_RUNNER', 'IN_TRANSIT', 'DELIVERED_TO_STORE', 'RECEIVED_BY_SELLER', 'PENDING_PAYMENT', 'PAID', 'RETURN_REQUESTED', 'ITEM_CHANGE_REQUESTED', 'MERGED_INTO_PARENT', 'CLOSED_BY_CHANGE', 'RETURN_CREATED', 'WAITING_FOR_RUNNER', 'IN_TRANSIT_TO_WAREHOUSE', 'DELIVERED_TO_WAREHOUSE', 'RECEIVED_BY_WAREHOUSE', 'RETURNED', 'TRANSFER_REQUESTED', 'DELIVERED_TO_DESTINATION', 'RECEIVED_BY_DESTINATION', 'TRANSFERRED', 'RESTOCK_REQUESTED', 'RECEIVED_BY_STORE', 'RESTOCKED', 'CANCELLED'`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    assertDestructiveDownAllowed(this.name);
    // CLOSED_BY_CHANGE no existía: esas originales vuelven a ITEM_CHANGE_REQUESTED, que es donde
    // estaban mientras esperaban el cambio (el cobro de su sub-orden habría que rehacerlo a mano).
    await queryRunner.query(
      `UPDATE "internal_orders" SET "status" = 'ITEM_CHANGE_REQUESTED' WHERE "status" = 'CLOSED_BY_CHANGE'`,
    );
    await queryRunner.query(
      `UPDATE "internal_order_events" SET "fromStatus" = NULL WHERE "fromStatus" = 'CLOSED_BY_CHANGE'`,
    );
    await queryRunner.query(
      `UPDATE "internal_order_events" SET "toStatus" = 'ITEM_CHANGE_REQUESTED' WHERE "toStatus" = 'CLOSED_BY_CHANGE'`,
    );
    await this.retype(queryRunner, `'NEW', 'ACCEPTED_BY_WAREHOUSE', 'PACKING', 'READY_FOR_RUNNER', 'IN_TRANSIT', 'DELIVERED_TO_STORE', 'RECEIVED_BY_SELLER', 'PENDING_PAYMENT', 'PAID', 'RETURN_REQUESTED', 'ITEM_CHANGE_REQUESTED', 'MERGED_INTO_PARENT', 'RETURN_CREATED', 'WAITING_FOR_RUNNER', 'IN_TRANSIT_TO_WAREHOUSE', 'DELIVERED_TO_WAREHOUSE', 'RECEIVED_BY_WAREHOUSE', 'RETURNED', 'TRANSFER_REQUESTED', 'DELIVERED_TO_DESTINATION', 'RECEIVED_BY_DESTINATION', 'TRANSFERRED', 'RESTOCK_REQUESTED', 'RECEIVED_BY_STORE', 'RESTOCKED', 'CANCELLED'`);
  }

  // Postgres no deja quitar un valor de un enum ni añadirlo y usarlo en la misma transacción: el
  // tipo se recrea y las tres columnas que lo usan se convierten por texto.
  private async retype(queryRunner: QueryRunner, values: string): Promise<void> {
    await queryRunner.query(`ALTER TYPE "public"."internal_order_status" RENAME TO "internal_order_status_old"`);
    await queryRunner.query(`CREATE TYPE "public"."internal_order_status" AS ENUM(${values})`);
    for (const [table, column] of [
      ['internal_orders', 'status'],
      ['internal_order_events', 'fromStatus'],
      ['internal_order_events', 'toStatus'],
    ]) {
      await queryRunner.query(
        `ALTER TABLE "${table}" ALTER COLUMN "${column}" TYPE "public"."internal_order_status" USING "${column}"::"text"::"public"."internal_order_status"`,
      );
    }
    await queryRunner.query(`DROP TYPE "public"."internal_order_status_old"`);
  }
}
