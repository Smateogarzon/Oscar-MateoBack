import { MigrationInterface, QueryRunner } from 'typeorm';
import { assertDestructiveDownAllowed } from '../../config/destructive-down.js';

export class AddPurchaseOrderItem1791300000001 implements MigrationInterface {
  name = 'AddPurchaseOrderItem1791300000001';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`CREATE TABLE "purchase_order_items" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "purchaseOrderId" uuid NOT NULL, "productVariantId" uuid NOT NULL, "quantity" numeric(12,2) NOT NULL, "receivedQuantity" numeric(12,2) NOT NULL DEFAULT '0', "unitCost" numeric(14,2) NOT NULL, CONSTRAINT "PK_e8b7568d25c41e3290db596b312" PRIMARY KEY ("id"))`);
    await queryRunner.query(`CREATE INDEX "IDX_f87619b4f55aeec2d0fb3c9c85" ON "purchase_order_items" ("productVariantId") `);
    await queryRunner.query(`CREATE UNIQUE INDEX "IDX_0edaf11ae4f0b1b27f3eb77771" ON "purchase_order_items" ("purchaseOrderId", "productVariantId") `);
    await queryRunner.query(`ALTER TABLE "purchase_order_items" ADD CONSTRAINT "FK_1de7eb246940b05765d2c99a7ec" FOREIGN KEY ("purchaseOrderId") REFERENCES "purchase_orders"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`);
    await queryRunner.query(`ALTER TABLE "purchase_order_items" ADD CONSTRAINT "FK_f87619b4f55aeec2d0fb3c9c858" FOREIGN KEY ("productVariantId") REFERENCES "product_variants"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    assertDestructiveDownAllowed(this.name);
    await queryRunner.query(`ALTER TABLE "purchase_order_items" DROP CONSTRAINT "FK_f87619b4f55aeec2d0fb3c9c858"`);
    await queryRunner.query(`ALTER TABLE "purchase_order_items" DROP CONSTRAINT "FK_1de7eb246940b05765d2c99a7ec"`);
    await queryRunner.query(`DROP INDEX "public"."IDX_0edaf11ae4f0b1b27f3eb77771"`);
    await queryRunner.query(`DROP INDEX "public"."IDX_f87619b4f55aeec2d0fb3c9c85"`);
    await queryRunner.query(`DROP TABLE "purchase_order_items"`);
  }
}
