import { MigrationInterface, QueryRunner } from 'typeorm';
import { assertDestructiveDownAllowed } from '../../config/destructive-down.js';

export class AddCashRegister1789925071074 implements MigrationInterface {
  name = 'AddCashRegister1789925071074';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`CREATE TABLE "cash_registers" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "storeId" uuid NOT NULL, "name" character varying(80) NOT NULL, "code" character varying(30) NOT NULL, "status" "public"."record_status" NOT NULL DEFAULT 'ACTIVE', CONSTRAINT "PK_c1cc711056395d079d8f041ce34" PRIMARY KEY ("id"))`);
    await queryRunner.query(`CREATE INDEX "IDX_543e731d358a64b36b69c1d9b6" ON "cash_registers"  ("storeId") `);
    await queryRunner.query(`CREATE UNIQUE INDEX "IDX_b42971d61db5cab5e2ee667126" ON "cash_registers"  ("storeId", "code") `);
    await queryRunner.query(`ALTER TABLE "cash_registers" ADD CONSTRAINT "FK_543e731d358a64b36b69c1d9b68" FOREIGN KEY ("storeId") REFERENCES "locations"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    assertDestructiveDownAllowed(this.name);
    await queryRunner.query(`ALTER TABLE "cash_registers" DROP CONSTRAINT "FK_543e731d358a64b36b69c1d9b68"`);
    await queryRunner.query(`DROP INDEX "public"."IDX_b42971d61db5cab5e2ee667126"`);
    await queryRunner.query(`DROP INDEX "public"."IDX_543e731d358a64b36b69c1d9b6"`);
    await queryRunner.query(`DROP TABLE "cash_registers"`);
  }
}
