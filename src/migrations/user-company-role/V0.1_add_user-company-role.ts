import { MigrationInterface, QueryRunner } from 'typeorm';
import { assertDestructiveDownAllowed } from '../../config/destructive-down.js';

export class AddUserCompanyRole1789511284028 implements MigrationInterface {
  name = 'AddUserCompanyRole1789511284028';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`CREATE TABLE "user_company_roles" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "userId" uuid NOT NULL, "companyId" uuid NOT NULL, "roleId" uuid NOT NULL, "status" "public"."record_status" NOT NULL DEFAULT 'ACTIVE', CONSTRAINT "PK_508675bf8cda811ec8ff812e337" PRIMARY KEY ("id"))`);
    await queryRunner.query(`CREATE INDEX "IDX_48031a3d3ab4aed4b46fc31905" ON "user_company_roles"  ("companyId") `);
    await queryRunner.query(`CREATE INDEX "IDX_de3eddd217378b6ced9075d8b5" ON "user_company_roles"  ("roleId") `);
    await queryRunner.query(`CREATE UNIQUE INDEX "IDX_b458c098346e96d3018ff7fbb6" ON "user_company_roles"  ("userId", "companyId", "roleId") `);
    await queryRunner.query(`ALTER TABLE "user_company_roles" ADD CONSTRAINT "FK_cb234fcd85a151f6c63403349ad" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`);
    await queryRunner.query(`ALTER TABLE "user_company_roles" ADD CONSTRAINT "FK_48031a3d3ab4aed4b46fc31905f" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`);
    await queryRunner.query(`ALTER TABLE "user_company_roles" ADD CONSTRAINT "FK_de3eddd217378b6ced9075d8b57" FOREIGN KEY ("roleId") REFERENCES "roles"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    assertDestructiveDownAllowed(this.name);
    await queryRunner.query(`ALTER TABLE "user_company_roles" DROP CONSTRAINT "FK_de3eddd217378b6ced9075d8b57"`);
    await queryRunner.query(`ALTER TABLE "user_company_roles" DROP CONSTRAINT "FK_48031a3d3ab4aed4b46fc31905f"`);
    await queryRunner.query(`ALTER TABLE "user_company_roles" DROP CONSTRAINT "FK_cb234fcd85a151f6c63403349ad"`);
    await queryRunner.query(`DROP INDEX "public"."IDX_b458c098346e96d3018ff7fbb6"`);
    await queryRunner.query(`DROP INDEX "public"."IDX_de3eddd217378b6ced9075d8b5"`);
    await queryRunner.query(`DROP INDEX "public"."IDX_48031a3d3ab4aed4b46fc31905"`);
    await queryRunner.query(`DROP TABLE "user_company_roles"`);
  }
}
