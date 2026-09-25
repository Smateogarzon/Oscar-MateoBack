import { MigrationInterface, QueryRunner } from 'typeorm';

export class UpdateCashMovement1790113968213 implements MigrationInterface {
  name = 'UpdateCashMovement1790113968213';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TYPE "public"."cash_movement_reason" RENAME TO "cash_movement_reason_old"`);
    await queryRunner.query(`CREATE TYPE "public"."cash_movement_reason" AS ENUM('EXPENSE', 'WITHDRAWAL', 'DEPOSIT', 'REFUND')`);
    await queryRunner.query(`ALTER TABLE "cash_movements" ALTER COLUMN "reason" TYPE "public"."cash_movement_reason" USING "reason"::"text"::"public"."cash_movement_reason"`);
    await queryRunner.query(`DROP TYPE "public"."cash_movement_reason_old"`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`CREATE TYPE "public"."cash_movement_reason_old" AS ENUM('MANUAL_INCOME', 'EXPENSE', 'WITHDRAWAL', 'DEPOSIT', 'REFUND', 'ADJUSTMENT', 'OTHER')`);
    await queryRunner.query(`ALTER TABLE "cash_movements" ALTER COLUMN "reason" TYPE "public"."cash_movement_reason_old" USING "reason"::"text"::"public"."cash_movement_reason_old"`);
    await queryRunner.query(`DROP TYPE "public"."cash_movement_reason"`);
    await queryRunner.query(`ALTER TYPE "public"."cash_movement_reason_old" RENAME TO "cash_movement_reason"`);
  }
}
