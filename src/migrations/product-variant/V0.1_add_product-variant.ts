import { MigrationInterface, QueryRunner } from 'typeorm';
import { assertDestructiveDownAllowed } from '../../config/destructive-down.js';

export class AddProductVariant1790691651165 implements MigrationInterface {
  name = 'AddProductVariant1790691651165';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`CREATE TABLE "product_variants" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "companyId" uuid NOT NULL, "productId" uuid NOT NULL, "colorId" uuid NOT NULL, "sizeId" uuid NOT NULL, "sku" character varying(100) NOT NULL, "cost" numeric(14,2) NOT NULL, "price" numeric(14,2) NOT NULL, "imageUrl" text, "status" "public"."record_status" NOT NULL DEFAULT 'ACTIVE', CONSTRAINT "PK_281e3f2c55652d6a22c0aa59fd7" PRIMARY KEY ("id"))`);
    await queryRunner.query(`CREATE INDEX "IDX_6e1fa8f57ef34c2bc503e1997f" ON "product_variants"  ("companyId") `);
    await queryRunner.query(`CREATE INDEX "IDX_f515690c571a03400a9876600b" ON "product_variants"  ("productId") `);
    await queryRunner.query(`CREATE INDEX "IDX_a25f8063109b6344800b860348" ON "product_variants"  ("colorId") `);
    await queryRunner.query(`CREATE INDEX "IDX_0e271925ab3814da891704b02b" ON "product_variants"  ("sizeId") `);
    await queryRunner.query(`CREATE UNIQUE INDEX "IDX_819d317d3010bd3a71c5dd1a2c" ON "product_variants"  ("productId", "colorId", "sizeId") `);
    await queryRunner.query(`CREATE UNIQUE INDEX "IDX_2eda39a3faa2ed4550267056da" ON "product_variants"  ("companyId", "sku") `);
    await queryRunner.query(`ALTER TABLE "product_variants" ADD CONSTRAINT "FK_6e1fa8f57ef34c2bc503e1997f9" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`);
    await queryRunner.query(`ALTER TABLE "product_variants" ADD CONSTRAINT "FK_f515690c571a03400a9876600b5" FOREIGN KEY ("productId") REFERENCES "products"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`);
    await queryRunner.query(`ALTER TABLE "product_variants" ADD CONSTRAINT "FK_a25f8063109b6344800b860348d" FOREIGN KEY ("colorId") REFERENCES "colors"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`);
    await queryRunner.query(`ALTER TABLE "product_variants" ADD CONSTRAINT "FK_0e271925ab3814da891704b02bd" FOREIGN KEY ("sizeId") REFERENCES "sizes"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    assertDestructiveDownAllowed(this.name);
    await queryRunner.query(`ALTER TABLE "product_variants" DROP CONSTRAINT "FK_0e271925ab3814da891704b02bd"`);
    await queryRunner.query(`ALTER TABLE "product_variants" DROP CONSTRAINT "FK_a25f8063109b6344800b860348d"`);
    await queryRunner.query(`ALTER TABLE "product_variants" DROP CONSTRAINT "FK_f515690c571a03400a9876600b5"`);
    await queryRunner.query(`ALTER TABLE "product_variants" DROP CONSTRAINT "FK_6e1fa8f57ef34c2bc503e1997f9"`);
    await queryRunner.query(`DROP INDEX "public"."IDX_2eda39a3faa2ed4550267056da"`);
    await queryRunner.query(`DROP INDEX "public"."IDX_819d317d3010bd3a71c5dd1a2c"`);
    await queryRunner.query(`DROP INDEX "public"."IDX_0e271925ab3814da891704b02b"`);
    await queryRunner.query(`DROP INDEX "public"."IDX_a25f8063109b6344800b860348"`);
    await queryRunner.query(`DROP INDEX "public"."IDX_f515690c571a03400a9876600b"`);
    await queryRunner.query(`DROP INDEX "public"."IDX_6e1fa8f57ef34c2bc503e1997f"`);
    await queryRunner.query(`DROP TABLE "product_variants"`);
  }
}
