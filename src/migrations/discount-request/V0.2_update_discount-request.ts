import { MigrationInterface, QueryRunner } from 'typeorm';

export class UpdateDiscountRequest1790364397038 implements MigrationInterface {
  name = 'UpdateDiscountRequest1790364397038';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "discount_requests" ADD "approvedBy" uuid`);
    await queryRunner.query(`ALTER TABLE "discount_requests" ADD "approvedAt" TIMESTAMP WITH TIME ZONE`);
    await queryRunner.query(`ALTER TABLE "discount_requests" ADD "lastEditedBy" uuid`);
    await queryRunner.query(`ALTER TABLE "discount_requests" ADD "lastEditedAt" TIMESTAMP WITH TIME ZONE`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "discount_requests" DROP COLUMN "lastEditedAt"`);
    await queryRunner.query(`ALTER TABLE "discount_requests" DROP COLUMN "lastEditedBy"`);
    await queryRunner.query(`ALTER TABLE "discount_requests" DROP COLUMN "approvedAt"`);
    await queryRunner.query(`ALTER TABLE "discount_requests" DROP COLUMN "approvedBy"`);
  }
}
