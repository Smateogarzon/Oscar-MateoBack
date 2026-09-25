import { MigrationInterface, QueryRunner } from 'typeorm';

export class UpdateUser1790364397037 implements MigrationInterface {
  name = 'UpdateUser1790364397037';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "users" ADD "passwordChangedAt" TIMESTAMP WITH TIME ZONE`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "users" DROP COLUMN "passwordChangedAt"`);
  }
}
