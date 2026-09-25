import { MigrationInterface, QueryRunner } from 'typeorm';

export class UpdateSaleReturn1790364397039 implements MigrationInterface {
  name = 'UpdateSaleReturn1790364397039';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "sale_returns" ADD "approvedBy" uuid`);
    await queryRunner.query(`ALTER TABLE "sale_returns" ADD "approvedAt" TIMESTAMP WITH TIME ZONE`);
    await queryRunner.query(`ALTER TABLE "sale_returns" ADD "lastEditedBy" uuid`);
    await queryRunner.query(`ALTER TABLE "sale_returns" ADD "lastEditedAt" TIMESTAMP WITH TIME ZONE`);
    await queryRunner.query(`ALTER TABLE "sale_returns" ADD "cancelledBy" uuid`);
    await queryRunner.query(`ALTER TABLE "sale_returns" ADD "cancelledAt" TIMESTAMP WITH TIME ZONE`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "sale_returns" DROP COLUMN "cancelledAt"`);
    await queryRunner.query(`ALTER TABLE "sale_returns" DROP COLUMN "cancelledBy"`);
    await queryRunner.query(`ALTER TABLE "sale_returns" DROP COLUMN "lastEditedAt"`);
    await queryRunner.query(`ALTER TABLE "sale_returns" DROP COLUMN "lastEditedBy"`);
    await queryRunner.query(`ALTER TABLE "sale_returns" DROP COLUMN "approvedAt"`);
    await queryRunner.query(`ALTER TABLE "sale_returns" DROP COLUMN "approvedBy"`);
  }
}
