import { MigrationInterface, QueryRunner } from 'typeorm';
import { assertDestructiveDownAllowed } from '../../config/destructive-down.js';

// El recorrido de una orden de compra cambia (acordado con el usuario, 2026-10-03): el
// administrador la crea, el PROVEEDOR la cuenta y la despacha, y el BODEGUERO la cuenta y la
// acepta —y es ahí, no antes, cuando entra la existencia al inventario—.
//
// Lo que se va del estado:
//   CONFIRMED            el proveedor ya no "confirma" aparte: revisar la orden es parte de
//                        despacharla. Las que estén así vuelven a SENT (siguen esperando despacho).
//   PARTIALLY_RECEIVED   ya no se entrega en tandas: lo que el proveedor no mande queda como
//                        novedad, no como entrega pendiente. Las que estén así pasan a RECEIVED,
//                        que es lo que son: la mercancía que llegó ya entró al inventario.
// Y entra SHIPPED: despachada por el proveedor, en camino a la bodega.
//
// `confirmedAt` pasa a llamarse `shippedAt` (la fecha en que el proveedor la puso en camino) y
// aparece `receivedBy`: qué bodeguero la contó. Quién despachó no se guarda: siempre es
// `supplierId`.
export class ReworkPurchaseOrderFlow1791900000000 implements MigrationInterface {
  name = 'ReworkPurchaseOrderFlow1791900000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TYPE "public"."purchase_order_status" RENAME TO "purchase_order_status_old"`);
    await queryRunner.query(`CREATE TYPE "public"."purchase_order_status" AS ENUM('DRAFT', 'SENT', 'SHIPPED', 'RECEIVED', 'CANCELLED')`);
    await queryRunner.query(`ALTER TABLE "purchase_orders" ALTER COLUMN "status" DROP DEFAULT`);
    await queryRunner.query(`
      ALTER TABLE "purchase_orders" ALTER COLUMN "status" TYPE "public"."purchase_order_status"
      USING (
        CASE "status"::"text"
          WHEN 'CONFIRMED' THEN 'SENT'
          WHEN 'PARTIALLY_RECEIVED' THEN 'RECEIVED'
          ELSE "status"::"text"
        END
      )::"public"."purchase_order_status"
    `);
    await queryRunner.query(`ALTER TABLE "purchase_orders" ALTER COLUMN "status" SET DEFAULT 'DRAFT'`);
    await queryRunner.query(`DROP TYPE "public"."purchase_order_status_old"`);

    await queryRunner.query(`ALTER TABLE "purchase_orders" RENAME COLUMN "confirmedAt" TO "shippedAt"`);
    await queryRunner.query(`ALTER TABLE "purchase_orders" ADD "receivedBy" uuid`);
    await queryRunner.query(`ALTER TABLE "purchase_orders" ADD CONSTRAINT "FK_purchase_orders_receivedBy" FOREIGN KEY ("receivedBy") REFERENCES "users"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    assertDestructiveDownAllowed(this.name);
    await queryRunner.query(`ALTER TABLE "purchase_orders" DROP CONSTRAINT "FK_purchase_orders_receivedBy"`);
    await queryRunner.query(`ALTER TABLE "purchase_orders" DROP COLUMN "receivedBy"`);
    await queryRunner.query(`ALTER TABLE "purchase_orders" RENAME COLUMN "shippedAt" TO "confirmedAt"`);

    // SHIPPED no existía: lo más cercano de vuelta es CONFIRMED (el proveedor la aceptó y todavía
    // no la entregó).
    await queryRunner.query(`ALTER TYPE "public"."purchase_order_status" RENAME TO "purchase_order_status_new"`);
    await queryRunner.query(`CREATE TYPE "public"."purchase_order_status" AS ENUM('DRAFT', 'SENT', 'CONFIRMED', 'PARTIALLY_RECEIVED', 'RECEIVED', 'CANCELLED')`);
    await queryRunner.query(`ALTER TABLE "purchase_orders" ALTER COLUMN "status" DROP DEFAULT`);
    await queryRunner.query(`
      ALTER TABLE "purchase_orders" ALTER COLUMN "status" TYPE "public"."purchase_order_status"
      USING (
        CASE "status"::"text"
          WHEN 'SHIPPED' THEN 'CONFIRMED'
          ELSE "status"::"text"
        END
      )::"public"."purchase_order_status"
    `);
    await queryRunner.query(`ALTER TABLE "purchase_orders" ALTER COLUMN "status" SET DEFAULT 'DRAFT'`);
    await queryRunner.query(`DROP TYPE "public"."purchase_order_status_new"`);
  }
}
