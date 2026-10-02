import { MigrationInterface, QueryRunner } from 'typeorm';

export class UpdateProductVariant1790902399417 implements MigrationInterface {
  name = 'UpdateProductVariant1790902399417';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX "public"."IDX_2eda39a3faa2ed4550267056da"`);
    await queryRunner.query(`ALTER TABLE "product_variants" ADD CONSTRAINT "UQ_46f236f21640f9da218a063a866" UNIQUE ("sku")`);
    await queryRunner.query(`CREATE UNIQUE INDEX "IDX_2eda39a3faa2ed4550267056da" ON "product_variants"  ("companyId", "sku") `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX "public"."IDX_2eda39a3faa2ed4550267056da"`);
    await queryRunner.query(`ALTER TABLE "product_variants" DROP CONSTRAINT "UQ_46f236f21640f9da218a063a866"`);
    await queryRunner.query(`CREATE UNIQUE INDEX "IDX_2eda39a3faa2ed4550267056da" ON "product_variants" USING btree ("companyId", "sku") `);
  }
}
