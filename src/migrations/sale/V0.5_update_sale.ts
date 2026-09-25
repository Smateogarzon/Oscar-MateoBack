import { MigrationInterface, QueryRunner } from 'typeorm';

export class UpdateSale1790364397040 implements MigrationInterface {
  name = 'UpdateSale1790364397040';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX "public"."IDX_ccd464f729acb14dfcd2179feb"`);
    await queryRunner.query(`ALTER TABLE "sales" ALTER COLUMN "saleNumber" DROP NOT NULL`);
    await queryRunner.query(`CREATE UNIQUE INDEX "IDX_ccd464f729acb14dfcd2179feb" ON "sales"  ("companyId", "saleNumber") `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX "public"."IDX_ccd464f729acb14dfcd2179feb"`);
    await queryRunner.query(`ALTER TABLE "sales" ALTER COLUMN "saleNumber" SET NOT NULL`);
    await queryRunner.query(`CREATE UNIQUE INDEX "IDX_ccd464f729acb14dfcd2179feb" ON "sales" USING btree ("companyId", "saleNumber") `);
  }
}
