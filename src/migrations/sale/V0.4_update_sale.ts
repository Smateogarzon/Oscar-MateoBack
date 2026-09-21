import { MigrationInterface, QueryRunner } from 'typeorm';

export class UpdateSale1789955294202 implements MigrationInterface {
  name = 'UpdateSale1789955294202';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "sales" ADD "returnCredit" numeric(14,2) NOT NULL DEFAULT '0'`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "sales" DROP COLUMN "returnCredit"`);
  }
}
