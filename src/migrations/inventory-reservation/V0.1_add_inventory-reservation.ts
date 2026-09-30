import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddInventoryReservation1790691651172 implements MigrationInterface {
  name = 'AddInventoryReservation1790691651172';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`CREATE TABLE "inventory_reservations" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "productVariantId" uuid NOT NULL, "inventoryLocationId" uuid NOT NULL, "side" "public"."inventory_side" NOT NULL, "quantity" numeric(12,2) NOT NULL, "sourceType" "public"."inventory_source_type" NOT NULL, "sourceId" uuid NOT NULL, "sourceNumber" character varying(50), CONSTRAINT "PK_af438c0ce596eea6c4d472a0489" PRIMARY KEY ("id"))`);
    await queryRunner.query(`CREATE INDEX "IDX_2762da348701b9a8bd07892020" ON "inventory_reservations"  ("productVariantId") `);
    await queryRunner.query(`CREATE INDEX "IDX_ccdccef424b1a1bb9990ba114d" ON "inventory_reservations"  ("inventoryLocationId") `);
    await queryRunner.query(`CREATE INDEX "IDX_51af71893c9bc10e86b8d2836b" ON "inventory_reservations"  ("productVariantId", "inventoryLocationId", "side") `);
    await queryRunner.query(`ALTER TABLE "inventory_reservations" ADD CONSTRAINT "FK_2762da348701b9a8bd078920202" FOREIGN KEY ("productVariantId") REFERENCES "product_variants"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`);
    await queryRunner.query(`ALTER TABLE "inventory_reservations" ADD CONSTRAINT "FK_ccdccef424b1a1bb9990ba114df" FOREIGN KEY ("inventoryLocationId") REFERENCES "inventory_locations"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "inventory_reservations" DROP CONSTRAINT "FK_ccdccef424b1a1bb9990ba114df"`);
    await queryRunner.query(`ALTER TABLE "inventory_reservations" DROP CONSTRAINT "FK_2762da348701b9a8bd078920202"`);
    await queryRunner.query(`DROP INDEX "public"."IDX_51af71893c9bc10e86b8d2836b"`);
    await queryRunner.query(`DROP INDEX "public"."IDX_ccdccef424b1a1bb9990ba114d"`);
    await queryRunner.query(`DROP INDEX "public"."IDX_2762da348701b9a8bd07892020"`);
    await queryRunner.query(`DROP TABLE "inventory_reservations"`);
  }
}
