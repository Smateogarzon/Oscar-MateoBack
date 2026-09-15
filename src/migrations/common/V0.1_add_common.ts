import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddCommon1789511284020 implements MigrationInterface {
  name = 'AddCommon1789511284020';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`CREATE TYPE "public"."record_status" AS ENUM('ACTIVE', 'INACTIVE')`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TYPE "public"."record_status"`);
  }
}
