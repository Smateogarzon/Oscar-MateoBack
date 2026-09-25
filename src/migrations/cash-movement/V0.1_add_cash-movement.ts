import { MigrationInterface, QueryRunner } from 'typeorm';
import { assertDestructiveDownAllowed } from '../../config/destructive-down.js';

export class AddCashMovement1789925071081 implements MigrationInterface {
  name = 'AddCashMovement1789925071081';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`CREATE TYPE "public"."cash_movement_type" AS ENUM('CASH_IN', 'CASH_OUT')`);
    await queryRunner.query(`CREATE TYPE "public"."cash_movement_reason" AS ENUM('MANUAL_INCOME', 'EXPENSE', 'WITHDRAWAL', 'DEPOSIT', 'REFUND', 'ADJUSTMENT', 'OTHER')`);
    await queryRunner.query(`CREATE TABLE "cash_movements" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "cashSessionId" uuid NOT NULL, "type" "public"."cash_movement_type" NOT NULL, "reason" "public"."cash_movement_reason" NOT NULL, "amount" numeric(14,2) NOT NULL, "description" character varying(255), "referenceNumber" character varying(100), "createdBy" uuid NOT NULL, CONSTRAINT "PK_25faead19e1ff74153a01604d37" PRIMARY KEY ("id"))`);
    await queryRunner.query(`CREATE INDEX "IDX_29e0d65149af7e3e2f9397a351" ON "cash_movements"  ("cashSessionId") `);
    await queryRunner.query(`CREATE INDEX "IDX_02f03f7a47f56ea5194cab5568" ON "cash_movements"  ("type") `);
    await queryRunner.query(`ALTER TABLE "cash_movements" ADD CONSTRAINT "FK_29e0d65149af7e3e2f9397a351f" FOREIGN KEY ("cashSessionId") REFERENCES "cash_sessions"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`);
    await queryRunner.query(`ALTER TABLE "cash_movements" ADD CONSTRAINT "FK_754e037d998bccb56fa60962787" FOREIGN KEY ("createdBy") REFERENCES "users"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    assertDestructiveDownAllowed(this.name);
    await queryRunner.query(`ALTER TABLE "cash_movements" DROP CONSTRAINT "FK_754e037d998bccb56fa60962787"`);
    await queryRunner.query(`ALTER TABLE "cash_movements" DROP CONSTRAINT "FK_29e0d65149af7e3e2f9397a351f"`);
    await queryRunner.query(`DROP INDEX "public"."IDX_02f03f7a47f56ea5194cab5568"`);
    await queryRunner.query(`DROP INDEX "public"."IDX_29e0d65149af7e3e2f9397a351"`);
    await queryRunner.query(`DROP TABLE "cash_movements"`);
    await queryRunner.query(`DROP TYPE "public"."cash_movement_reason"`);
    await queryRunner.query(`DROP TYPE "public"."cash_movement_type"`);
  }
}
