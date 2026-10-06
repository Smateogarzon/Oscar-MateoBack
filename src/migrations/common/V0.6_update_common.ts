import { MigrationInterface, QueryRunner } from 'typeorm';

export class UpdateCommon1790902399413 implements MigrationInterface {
  name = 'UpdateCommon1790902399413';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX "public"."IDX_products_name_trgm"`);
  }

  // El índice de trigramas lo creó a mano product/V0.2_update_product; sin volver a crearlo aquí,
  // revertir hasta esa migración fallaba al intentar borrar un índice que ya no existía.
  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`CREATE INDEX "IDX_products_name_trgm" ON "products" USING gin ("name" gin_trgm_ops)`);
  }
}
