import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddInventoryBalance1790691651170 implements MigrationInterface {
  name = 'AddInventoryBalance1790691651170';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`CREATE TABLE "inventory_balances" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "productVariantId" uuid NOT NULL, "inventoryLocationId" uuid NOT NULL, "side" "public"."inventory_side" NOT NULL DEFAULT 'PAIR', "quantity" numeric(12,2) NOT NULL DEFAULT '0', "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "PK_4abb5082c6c3dcf55f1b124d2ea" PRIMARY KEY ("id"))`);
    await queryRunner.query(`CREATE INDEX "IDX_78e47b812764018e448a899509" ON "inventory_balances"  ("productVariantId") `);
    await queryRunner.query(`CREATE INDEX "IDX_dac6813b9de84275bca844bbb1" ON "inventory_balances"  ("inventoryLocationId") `);
    await queryRunner.query(`CREATE UNIQUE INDEX "IDX_c93b1932ba4077b4e4e504210e" ON "inventory_balances"  ("productVariantId", "inventoryLocationId", "side") `);
    await queryRunner.query(`ALTER TABLE "inventory_balances" ADD CONSTRAINT "FK_78e47b812764018e448a899509d" FOREIGN KEY ("productVariantId") REFERENCES "product_variants"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`);
    await queryRunner.query(`ALTER TABLE "inventory_balances" ADD CONSTRAINT "FK_dac6813b9de84275bca844bbb1f" FOREIGN KEY ("inventoryLocationId") REFERENCES "inventory_locations"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "inventory_balances" DROP CONSTRAINT "FK_dac6813b9de84275bca844bbb1f"`);
    await queryRunner.query(`ALTER TABLE "inventory_balances" DROP CONSTRAINT "FK_78e47b812764018e448a899509d"`);
    await queryRunner.query(`DROP INDEX "public"."IDX_c93b1932ba4077b4e4e504210e"`);
    await queryRunner.query(`DROP INDEX "public"."IDX_dac6813b9de84275bca844bbb1"`);
    await queryRunner.query(`DROP INDEX "public"."IDX_78e47b812764018e448a899509"`);
    await queryRunner.query(`DROP TABLE "inventory_balances"`);
  }
}
