import { MigrationInterface, QueryRunner } from 'typeorm';
import { assertDestructiveDownAllowed } from '../../config/destructive-down.js';

export class AddSale1789922366460 implements MigrationInterface {
  name = 'AddSale1789922366460';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`CREATE TYPE "public"."sale_item_type" AS ENUM('INVENTORIED', 'GENERIC')`);
    await queryRunner.query(`CREATE TABLE "sale_items" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "saleId" uuid NOT NULL, "type" "public"."sale_item_type" NOT NULL, "productVariantId" uuid, "description" character varying(180) NOT NULL, "sku" character varying(100), "quantity" numeric(12,2) NOT NULL, "unitPrice" numeric(14,2) NOT NULL, "discountAmount" numeric(14,2) NOT NULL DEFAULT '0', "total" numeric(14,2) NOT NULL, CONSTRAINT "PK_5a7dc5b4562a9e590528b3e08ab" PRIMARY KEY ("id"))`);
    await queryRunner.query(`CREATE INDEX "IDX_c642be08de5235317d4cf3deb4" ON "sale_items"  ("saleId") `);
    await queryRunner.query(`CREATE INDEX "IDX_c88b2296bc9d63289041db7978" ON "sale_items"  ("productVariantId") `);
    await queryRunner.query(`ALTER TABLE "sales" ADD "generalDiscount" numeric(14,2) NOT NULL DEFAULT '0'`);
    await queryRunner.query(`ALTER TABLE "sale_items" ADD CONSTRAINT "FK_c642be08de5235317d4cf3deb40" FOREIGN KEY ("saleId") REFERENCES "sales"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    assertDestructiveDownAllowed(this.name);
    await queryRunner.query(`ALTER TABLE "sale_items" DROP CONSTRAINT "FK_c642be08de5235317d4cf3deb40"`);
    await queryRunner.query(`ALTER TABLE "sales" DROP COLUMN "generalDiscount"`);
    await queryRunner.query(`DROP INDEX "public"."IDX_c88b2296bc9d63289041db7978"`);
    await queryRunner.query(`DROP INDEX "public"."IDX_c642be08de5235317d4cf3deb4"`);
    await queryRunner.query(`DROP TABLE "sale_items"`);
    await queryRunner.query(`DROP TYPE "public"."sale_item_type"`);
  }
}
