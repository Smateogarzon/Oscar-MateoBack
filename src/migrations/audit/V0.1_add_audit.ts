import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddAudit1791900000006 implements MigrationInterface {
  name = 'AddAudit1791900000006';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`CREATE TYPE "public"."audit_action" AS ENUM('CREATE', 'UPDATE', 'DELETE', 'STATUS_CHANGE', 'APPROVE', 'REJECT', 'CANCEL', 'LOGIN', 'LOGOUT')`);
    await queryRunner.query(`CREATE TABLE "audit_logs" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "companyId" uuid, "userId" uuid, "action" "public"."audit_action" NOT NULL, "entityType" character varying(60) NOT NULL, "entityId" uuid, "oldValues" jsonb, "newValues" jsonb, "description" character varying(255), "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "PK_1bb179d048bbc581caa3b013439" PRIMARY KEY ("id"))`);
    await queryRunner.query(`CREATE INDEX "IDX_c69efb19bf127c97e6740ad530" ON "audit_logs"  ("createdAt") `);
    await queryRunner.query(`CREATE INDEX "IDX_cee5459245f652b75eb2759b4c" ON "audit_logs"  ("action") `);
    await queryRunner.query(`CREATE INDEX "IDX_f23279fad63453147a8efb46cf" ON "audit_logs"  ("entityId") `);
    await queryRunner.query(`CREATE INDEX "IDX_01993ae76b293d3b866cc3a125" ON "audit_logs"  ("entityType") `);
    await queryRunner.query(`CREATE INDEX "IDX_cfa83f61e4d27a87fcae1e025a" ON "audit_logs"  ("userId") `);
    await queryRunner.query(`CREATE INDEX "IDX_efa597fecfef3d3ec683d69332" ON "audit_logs"  ("companyId") `);
    await queryRunner.query(`ALTER TABLE "audit_logs" ADD CONSTRAINT "FK_efa597fecfef3d3ec683d693324" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE SET NULL ON UPDATE NO ACTION`);
    await queryRunner.query(`ALTER TABLE "audit_logs" ADD CONSTRAINT "FK_cfa83f61e4d27a87fcae1e025ab" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE NO ACTION`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "audit_logs" DROP CONSTRAINT "FK_cfa83f61e4d27a87fcae1e025ab"`);
    await queryRunner.query(`ALTER TABLE "audit_logs" DROP CONSTRAINT "FK_efa597fecfef3d3ec683d693324"`);
    await queryRunner.query(`DROP INDEX "public"."IDX_efa597fecfef3d3ec683d69332"`);
    await queryRunner.query(`DROP INDEX "public"."IDX_cfa83f61e4d27a87fcae1e025a"`);
    await queryRunner.query(`DROP INDEX "public"."IDX_01993ae76b293d3b866cc3a125"`);
    await queryRunner.query(`DROP INDEX "public"."IDX_f23279fad63453147a8efb46cf"`);
    await queryRunner.query(`DROP INDEX "public"."IDX_cee5459245f652b75eb2759b4c"`);
    await queryRunner.query(`DROP INDEX "public"."IDX_c69efb19bf127c97e6740ad530"`);
    await queryRunner.query(`DROP TABLE "audit_logs"`);
    await queryRunner.query(`DROP TYPE "public"."audit_action"`);
  }
}
