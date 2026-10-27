import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddCommon1790691651158 implements MigrationInterface {
  name = 'AddCommon1790691651158';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`CREATE TYPE "public"."inventory_side" AS ENUM('PAIR', 'LEFT', 'RIGHT')`);
    await queryRunner.query(`CREATE TYPE "public"."inventory_source_type" AS ENUM('SALE', 'SALE_RETURN', 'PURCHASE_ORDER', 'TRANSFER_REQUEST', 'MANUAL_ADJUSTMENT', 'RUNNER_ASSIGNMENT')`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TYPE "public"."inventory_source_type"`);
    await queryRunner.query(`DROP TYPE "public"."inventory_side"`);
  }
}
