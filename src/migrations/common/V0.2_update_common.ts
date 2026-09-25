import { MigrationInterface, QueryRunner } from 'typeorm';

export class UpdateCommon1789929962116 implements MigrationInterface {
  name = 'UpdateCommon1789929962116';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX "public"."IDX_60e7e0e323beab94352e20b6af"`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {

  }
}
