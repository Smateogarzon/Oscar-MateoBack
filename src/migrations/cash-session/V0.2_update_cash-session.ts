import { MigrationInterface, QueryRunner } from 'typeorm';

export class UpdateCashSession1789929962118 implements MigrationInterface {
  name = 'UpdateCashSession1789929962118';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "cash_sessions" ADD "cashierId" uuid NOT NULL`);
    await queryRunner.query(`ALTER TABLE "cash_sessions" ADD "movementCode" character varying(6) NOT NULL`);
    await queryRunner.query(`ALTER TABLE "cash_sessions" ADD "movementCodeFailures" integer NOT NULL DEFAULT '0'`);
    await queryRunner.query(`CREATE INDEX "IDX_bbd26e96daf91c4976137b2aea" ON "cash_sessions"  ("cashierId") `);
    await queryRunner.query(`CREATE UNIQUE INDEX "IDX_480db45e12c56ed789515b11b0" ON "cash_sessions"  ("cashierId") WHERE "status" = 'OPEN'`);
    await queryRunner.query(`ALTER TABLE "cash_sessions" ADD CONSTRAINT "FK_bbd26e96daf91c4976137b2aea7" FOREIGN KEY ("cashierId") REFERENCES "users"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "cash_sessions" DROP CONSTRAINT "FK_bbd26e96daf91c4976137b2aea7"`);
    await queryRunner.query(`DROP INDEX "public"."IDX_480db45e12c56ed789515b11b0"`);
    await queryRunner.query(`DROP INDEX "public"."IDX_bbd26e96daf91c4976137b2aea"`);
    await queryRunner.query(`ALTER TABLE "cash_sessions" DROP COLUMN "movementCodeFailures"`);
    await queryRunner.query(`ALTER TABLE "cash_sessions" DROP COLUMN "movementCode"`);
    await queryRunner.query(`ALTER TABLE "cash_sessions" DROP COLUMN "cashierId"`);
    await queryRunner.query(`CREATE UNIQUE INDEX "IDX_60e7e0e323beab94352e20b6af" ON "cash_sessions" USING btree ("openedBy") WHERE (status = 'OPEN'::cash_session_status)`);
  }
}
