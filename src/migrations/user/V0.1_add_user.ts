import { MigrationInterface, QueryRunner } from 'typeorm';
import { assertDestructiveDownAllowed } from '../../config/destructive-down.js';

export class AddUser1789511284021 implements MigrationInterface {
  name = 'AddUser1789511284021';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`CREATE TABLE "users" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "firstName" character varying(80) NOT NULL, "lastName" character varying(80) NOT NULL, "email" character varying(150) NOT NULL, "phone" character varying(30), "documentNumber" character varying(30), "passwordHash" text NOT NULL, "avatarUrl" text, "status" "public"."record_status" NOT NULL DEFAULT 'ACTIVE', "mustChangePassword" boolean NOT NULL DEFAULT true, "lastLoginAt" TIMESTAMP WITH TIME ZONE, CONSTRAINT "UQ_97672ac88f789774dd47f7c8be3" UNIQUE ("email"), CONSTRAINT "PK_a3ffb1c0c8416b9fc6f907b7433" PRIMARY KEY ("id"))`);
    await queryRunner.query(`CREATE INDEX "IDX_9919ce10860709c1f0f115062b" ON "users"  ("documentNumber") `);
    await queryRunner.query(`CREATE INDEX "IDX_3676155292d72c67cd4e090514" ON "users"  ("status") `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    assertDestructiveDownAllowed(this.name);
    await queryRunner.query(`DROP INDEX "public"."IDX_3676155292d72c67cd4e090514"`);
    await queryRunner.query(`DROP INDEX "public"."IDX_9919ce10860709c1f0f115062b"`);
    await queryRunner.query(`DROP TABLE "users"`);
  }
}
