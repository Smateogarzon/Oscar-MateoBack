import { MigrationInterface, QueryRunner } from 'typeorm';

export class UpdateSale1790691651173 implements MigrationInterface {
  name = 'UpdateSale1790691651173';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "sale_items" ADD CONSTRAINT "FK_c88b2296bc9d63289041db79781" FOREIGN KEY ("productVariantId") REFERENCES "product_variants"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "sale_items" DROP CONSTRAINT "FK_c88b2296bc9d63289041db79781"`);
  }
}
