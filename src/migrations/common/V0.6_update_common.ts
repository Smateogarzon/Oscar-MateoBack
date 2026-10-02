import { MigrationInterface, QueryRunner } from 'typeorm';

export class UpdateCommon1790902399413 implements MigrationInterface {
  name = 'UpdateCommon1790902399413';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX "public"."IDX_products_name_trgm"`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {

  }
}
