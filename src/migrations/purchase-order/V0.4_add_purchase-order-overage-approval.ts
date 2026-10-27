import { MigrationInterface, QueryRunner } from 'typeorm';
import { assertDestructiveDownAllowed } from '../../config/destructive-down.js';

// El proveedor puede despachar MÁS de lo que se le pidió (acordado con el usuario, 2026-10-03):
// antes el servidor lo rechazaba. Ahora pasa, pero no sigue solo: la orden queda en
// PENDING_APPROVAL y el administrador autoriza el sobrante línea por línea antes de que bodega
// pueda recibirla. Si rechaza una sola línea, el despacho se deshace y la orden vuelve a SENT.
//
// Y `hasIncidents` marca la orden que trae alguna novedad —de menos, de más, o lo que no cuadró al
// recibir—, para que la lista la pinte distinto sin tener que traerse las líneas de cada una.
export class AddPurchaseOrderOverageApproval1791900000003 implements MigrationInterface {
  name = 'AddPurchaseOrderOverageApproval1791900000003';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TYPE "public"."purchase_order_status" RENAME TO "purchase_order_status_old"`);
    await queryRunner.query(`CREATE TYPE "public"."purchase_order_status" AS ENUM('DRAFT', 'SENT', 'PENDING_APPROVAL', 'SHIPPED', 'RECEIVED', 'CANCELLED')`);
    await queryRunner.query(`ALTER TABLE "purchase_orders" ALTER COLUMN "status" DROP DEFAULT`);
    await queryRunner.query(`ALTER TABLE "purchase_orders" ALTER COLUMN "status" TYPE "public"."purchase_order_status" USING "status"::"text"::"public"."purchase_order_status"`);
    await queryRunner.query(`ALTER TABLE "purchase_orders" ALTER COLUMN "status" SET DEFAULT 'DRAFT'`);
    await queryRunner.query(`DROP TYPE "public"."purchase_order_status_old"`);

    await queryRunner.query(`ALTER TABLE "purchase_orders" ADD "hasIncidents" boolean NOT NULL DEFAULT false`);
    // Las órdenes que ya existen: tienen novedad las que tengan alguna línea con una.
    await queryRunner.query(`
      UPDATE "purchase_orders" o SET "hasIncidents" = true
      WHERE EXISTS (
        SELECT 1 FROM "purchase_order_items" i
        WHERE i."purchaseOrderId" = o."id"
          AND (i."shipmentIncidentId" IS NOT NULL OR i."receptionIncidentId" IS NOT NULL)
      )
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    assertDestructiveDownAllowed(this.name);
    await queryRunner.query(`ALTER TABLE "purchase_orders" DROP COLUMN "hasIncidents"`);

    // PENDING_APPROVAL no existía: esas órdenes vuelven a SENT, que es donde quedan cuando se
    // rechaza el sobrante (el despacho se tendría que volver a hacer).
    await queryRunner.query(`ALTER TYPE "public"."purchase_order_status" RENAME TO "purchase_order_status_new"`);
    await queryRunner.query(`CREATE TYPE "public"."purchase_order_status" AS ENUM('DRAFT', 'SENT', 'SHIPPED', 'RECEIVED', 'CANCELLED')`);
    await queryRunner.query(`ALTER TABLE "purchase_orders" ALTER COLUMN "status" DROP DEFAULT`);
    await queryRunner.query(`
      ALTER TABLE "purchase_orders" ALTER COLUMN "status" TYPE "public"."purchase_order_status"
      USING (
        CASE "status"::"text"
          WHEN 'PENDING_APPROVAL' THEN 'SENT'
          ELSE "status"::"text"
        END
      )::"public"."purchase_order_status"
    `);
    await queryRunner.query(`ALTER TABLE "purchase_orders" ALTER COLUMN "status" SET DEFAULT 'DRAFT'`);
    await queryRunner.query(`DROP TYPE "public"."purchase_order_status_new"`);
  }
}
