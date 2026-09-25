import { MigrationInterface, QueryRunner } from 'typeorm';

export class UpdateCommon1790220768423 implements MigrationInterface {
  name = 'UpdateCommon1790220768423';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX "public"."IDX_store_payment_methods_store_method"`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {

  }
}
