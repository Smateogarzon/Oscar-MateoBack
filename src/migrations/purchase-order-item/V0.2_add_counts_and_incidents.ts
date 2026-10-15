import { MigrationInterface, QueryRunner } from 'typeorm';
import { assertDestructiveDownAllowed } from '../../config/destructive-down.js';

// Las tres cifras de una línea, ahora que la orden se cuenta dos veces (ver
// V0.3_rework_purchase-order-flow): lo pedido (`quantity`), lo que contó y despachó el proveedor
// (`shippedQuantity`) y lo que contó el bodeguero al recibir (`receivedQuantity`, la que entra al
// inventario). Las dos últimas quedan nulas mientras nadie las haya contado: con el 0 por defecto
// de antes no se distinguía "todavía no se cuenta" de "se contó y no había nada".
//
// Y dos novedades por línea, las que nacen solas cuando una cifra no cuadra con la anterior
// (ver purchase-order-incidents.ts): la del proveedor que mandó de menos y la de bodega que contó
// distinto de lo despachado.
//
// Las líneas que ya existen conservan su `receivedQuantity` tal como estaba (0 incluido): son de
// órdenes del recorrido viejo y no hay forma de saber qué se contó en cada paso.
export class AddPurchaseOrderItemCountsAndIncidents1791900000001 implements MigrationInterface {
  name = 'AddPurchaseOrderItemCountsAndIncidents1791900000001';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "purchase_order_items" ADD "shippedQuantity" numeric(12,2)`);
    await queryRunner.query(`ALTER TABLE "purchase_order_items" ALTER COLUMN "receivedQuantity" DROP DEFAULT`);
    await queryRunner.query(`ALTER TABLE "purchase_order_items" ALTER COLUMN "receivedQuantity" DROP NOT NULL`);
    await queryRunner.query(`ALTER TABLE "purchase_order_items" ADD "shipmentIncidentId" uuid`);
    await queryRunner.query(`ALTER TABLE "purchase_order_items" ADD "receptionIncidentId" uuid`);
    await queryRunner.query(`ALTER TABLE "purchase_order_items" ADD CONSTRAINT "FK_purchase_order_items_shipmentIncidentId" FOREIGN KEY ("shipmentIncidentId") REFERENCES "incidents"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`);
    await queryRunner.query(`ALTER TABLE "purchase_order_items" ADD CONSTRAINT "FK_purchase_order_items_receptionIncidentId" FOREIGN KEY ("receptionIncidentId") REFERENCES "incidents"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    assertDestructiveDownAllowed(this.name);
    await queryRunner.query(`ALTER TABLE "purchase_order_items" DROP CONSTRAINT "FK_purchase_order_items_receptionIncidentId"`);
    await queryRunner.query(`ALTER TABLE "purchase_order_items" DROP CONSTRAINT "FK_purchase_order_items_shipmentIncidentId"`);
    await queryRunner.query(`ALTER TABLE "purchase_order_items" DROP COLUMN "receptionIncidentId"`);
    await queryRunner.query(`ALTER TABLE "purchase_order_items" DROP COLUMN "shipmentIncidentId"`);
    await queryRunner.query(`UPDATE "purchase_order_items" SET "receivedQuantity" = 0 WHERE "receivedQuantity" IS NULL`);
    await queryRunner.query(`ALTER TABLE "purchase_order_items" ALTER COLUMN "receivedQuantity" SET NOT NULL`);
    await queryRunner.query(`ALTER TABLE "purchase_order_items" ALTER COLUMN "receivedQuantity" SET DEFAULT '0'`);
    await queryRunner.query(`ALTER TABLE "purchase_order_items" DROP COLUMN "shippedQuantity"`);
  }
}
