import { MigrationInterface, QueryRunner } from 'typeorm';
import { assertDestructiveDownAllowed } from '../../config/destructive-down.js';

export class AddInventoryMovement1790691651171 implements MigrationInterface {
  name = 'AddInventoryMovement1790691651171';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`CREATE TYPE "public"."inventory_movement_type" AS ENUM('PURCHASE', 'TRANSFER', 'SALE', 'RETURN', 'ADJUSTMENT', 'DAMAGE', 'RUNNER_PICKUP', 'RUNNER_DELIVERY', 'DISPLAY_TRANSFER', 'INITIAL_STOCK')`);
    await queryRunner.query(`CREATE TABLE "inventory_movements" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "companyId" uuid NOT NULL, "productVariantId" uuid NOT NULL, "fromLocationId" uuid, "toLocationId" uuid, "side" "public"."inventory_side" NOT NULL, "quantity" numeric(12,2) NOT NULL, "type" "public"."inventory_movement_type" NOT NULL, "sourceType" "public"."inventory_source_type" NOT NULL, "sourceId" uuid, "sourceNumber" character varying(50), "notes" character varying(255), "createdBy" uuid NOT NULL, CONSTRAINT "PK_d7597827c1dcffae889db3ab873" PRIMARY KEY ("id"))`);
    await queryRunner.query(`CREATE INDEX "IDX_7ab3cfa0e6d289479f98ae9098" ON "inventory_movements"  ("companyId") `);
    await queryRunner.query(`CREATE INDEX "IDX_5c740da110af2e5dbf8b57c507" ON "inventory_movements"  ("productVariantId") `);
    await queryRunner.query(`CREATE INDEX "IDX_2ca31c735d4c529e3954fb81de" ON "inventory_movements"  ("fromLocationId") `);
    await queryRunner.query(`CREATE INDEX "IDX_7051bd9600109562d97a5d9a89" ON "inventory_movements"  ("toLocationId") `);
    await queryRunner.query(`CREATE INDEX "IDX_27ed7365112c780f235eb251ff" ON "inventory_movements"  ("companyId", "productVariantId") `);
    await queryRunner.query(`ALTER TABLE "inventory_movements" ADD CONSTRAINT "FK_7ab3cfa0e6d289479f98ae90982" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`);
    await queryRunner.query(`ALTER TABLE "inventory_movements" ADD CONSTRAINT "FK_5c740da110af2e5dbf8b57c507d" FOREIGN KEY ("productVariantId") REFERENCES "product_variants"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`);
    await queryRunner.query(`ALTER TABLE "inventory_movements" ADD CONSTRAINT "FK_2ca31c735d4c529e3954fb81dee" FOREIGN KEY ("fromLocationId") REFERENCES "inventory_locations"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`);
    await queryRunner.query(`ALTER TABLE "inventory_movements" ADD CONSTRAINT "FK_7051bd9600109562d97a5d9a892" FOREIGN KEY ("toLocationId") REFERENCES "inventory_locations"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`);
    await queryRunner.query(`ALTER TABLE "inventory_movements" ADD CONSTRAINT "FK_c85085cf8c6d3fa249279ee9e38" FOREIGN KEY ("createdBy") REFERENCES "users"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    assertDestructiveDownAllowed(this.name);
    await queryRunner.query(`ALTER TABLE "inventory_movements" DROP CONSTRAINT "FK_c85085cf8c6d3fa249279ee9e38"`);
    await queryRunner.query(`ALTER TABLE "inventory_movements" DROP CONSTRAINT "FK_7051bd9600109562d97a5d9a892"`);
    await queryRunner.query(`ALTER TABLE "inventory_movements" DROP CONSTRAINT "FK_2ca31c735d4c529e3954fb81dee"`);
    await queryRunner.query(`ALTER TABLE "inventory_movements" DROP CONSTRAINT "FK_5c740da110af2e5dbf8b57c507d"`);
    await queryRunner.query(`ALTER TABLE "inventory_movements" DROP CONSTRAINT "FK_7ab3cfa0e6d289479f98ae90982"`);
    await queryRunner.query(`DROP INDEX "public"."IDX_27ed7365112c780f235eb251ff"`);
    await queryRunner.query(`DROP INDEX "public"."IDX_7051bd9600109562d97a5d9a89"`);
    await queryRunner.query(`DROP INDEX "public"."IDX_2ca31c735d4c529e3954fb81de"`);
    await queryRunner.query(`DROP INDEX "public"."IDX_5c740da110af2e5dbf8b57c507"`);
    await queryRunner.query(`DROP INDEX "public"."IDX_7ab3cfa0e6d289479f98ae9098"`);
    await queryRunner.query(`DROP TABLE "inventory_movements"`);
    await queryRunner.query(`DROP TYPE "public"."inventory_movement_type"`);
  }
}
