import { MigrationInterface, QueryRunner } from 'typeorm';

export class UpdateSale1789925071079 implements MigrationInterface {
  name = 'UpdateSale1789925071079';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "sale_items" ADD "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()`);
    await queryRunner.query(`ALTER TABLE "sales" ADD CONSTRAINT "FK_b499133d93f00504df0aeccfc23" FOREIGN KEY ("cashSessionId") REFERENCES "cash_sessions"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "sales" DROP CONSTRAINT "FK_b499133d93f00504df0aeccfc23"`);
    await queryRunner.query(`ALTER TABLE "sale_items" DROP COLUMN "updatedAt"`);
  }
}
