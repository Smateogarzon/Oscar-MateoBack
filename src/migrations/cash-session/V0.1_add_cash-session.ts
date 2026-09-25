import { MigrationInterface, QueryRunner } from 'typeorm';
import { assertDestructiveDownAllowed } from '../../config/destructive-down.js';

export class AddCashSession1789925071078 implements MigrationInterface {
  name = 'AddCashSession1789925071078';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`CREATE TYPE "public"."cash_session_status" AS ENUM('OPEN', 'CLOSED')`);
    await queryRunner.query(`CREATE TABLE "cash_sessions" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "cashRegisterId" uuid NOT NULL, "openedBy" uuid NOT NULL, "closedBy" uuid, "openingAmount" numeric(14,2) NOT NULL DEFAULT '0', "expectedAmount" numeric(14,2), "countedAmount" numeric(14,2), "differenceAmount" numeric(14,2), "status" "public"."cash_session_status" NOT NULL DEFAULT 'OPEN', "openedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "closedAt" TIMESTAMP WITH TIME ZONE, "notes" character varying(255), CONSTRAINT "PK_946ea5ce864b10fb70162708448" PRIMARY KEY ("id"))`);
    await queryRunner.query(`CREATE INDEX "IDX_e61a93525d6ec464a20b7e2fff" ON "cash_sessions"  ("cashRegisterId") `);
    await queryRunner.query(`CREATE INDEX "IDX_47520bb834385b5031b64b4148" ON "cash_sessions"  ("status") `);
    await queryRunner.query(`CREATE UNIQUE INDEX "IDX_60e7e0e323beab94352e20b6af" ON "cash_sessions"  ("openedBy") WHERE "status" = 'OPEN'`);
    await queryRunner.query(`CREATE UNIQUE INDEX "IDX_0f325bbdcf03f9a87aa1cbd2b0" ON "cash_sessions"  ("cashRegisterId") WHERE "status" = 'OPEN'`);
    await queryRunner.query(`ALTER TABLE "cash_sessions" ADD CONSTRAINT "FK_e61a93525d6ec464a20b7e2fff5" FOREIGN KEY ("cashRegisterId") REFERENCES "cash_registers"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`);
    await queryRunner.query(`ALTER TABLE "cash_sessions" ADD CONSTRAINT "FK_99aa11988443e08c863931f46b8" FOREIGN KEY ("openedBy") REFERENCES "users"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`);
    await queryRunner.query(`ALTER TABLE "cash_sessions" ADD CONSTRAINT "FK_4cc4d342347ccfc11ce5eafbb24" FOREIGN KEY ("closedBy") REFERENCES "users"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    assertDestructiveDownAllowed(this.name);
    await queryRunner.query(`ALTER TABLE "cash_sessions" DROP CONSTRAINT "FK_4cc4d342347ccfc11ce5eafbb24"`);
    await queryRunner.query(`ALTER TABLE "cash_sessions" DROP CONSTRAINT "FK_99aa11988443e08c863931f46b8"`);
    await queryRunner.query(`ALTER TABLE "cash_sessions" DROP CONSTRAINT "FK_e61a93525d6ec464a20b7e2fff5"`);
    await queryRunner.query(`DROP INDEX "public"."IDX_0f325bbdcf03f9a87aa1cbd2b0"`);
    await queryRunner.query(`DROP INDEX "public"."IDX_60e7e0e323beab94352e20b6af"`);
    await queryRunner.query(`DROP INDEX "public"."IDX_47520bb834385b5031b64b4148"`);
    await queryRunner.query(`DROP INDEX "public"."IDX_e61a93525d6ec464a20b7e2fff"`);
    await queryRunner.query(`DROP TABLE "cash_sessions"`);
    await queryRunner.query(`DROP TYPE "public"."cash_session_status"`);
  }
}
