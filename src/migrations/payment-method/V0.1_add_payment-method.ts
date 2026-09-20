import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddPaymentMethod1789925071076 implements MigrationInterface {
  name = 'AddPaymentMethod1789925071076';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`CREATE TYPE "public"."payment_method_type" AS ENUM('CASH', 'CARD', 'TRANSFER')`);
    await queryRunner.query(`CREATE TABLE "payment_methods" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "companyId" uuid NOT NULL, "name" character varying(80) NOT NULL, "type" "public"."payment_method_type" NOT NULL, "requiresReference" boolean NOT NULL DEFAULT false, "status" "public"."record_status" NOT NULL DEFAULT 'ACTIVE', CONSTRAINT "PK_34f9b8c6dfb4ac3559f7e2820d1" PRIMARY KEY ("id"))`);
    await queryRunner.query(`CREATE INDEX "IDX_c9136b030564fc0b44a8aac252" ON "payment_methods"  ("companyId") `);
    await queryRunner.query(`CREATE UNIQUE INDEX "IDX_753efca6378ceba1e8b471dfcc" ON "payment_methods"  ("companyId", "name") `);
    await queryRunner.query(`ALTER TABLE "payment_methods" ADD CONSTRAINT "FK_c9136b030564fc0b44a8aac2524" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "payment_methods" DROP CONSTRAINT "FK_c9136b030564fc0b44a8aac2524"`);
    await queryRunner.query(`DROP INDEX "public"."IDX_753efca6378ceba1e8b471dfcc"`);
    await queryRunner.query(`DROP INDEX "public"."IDX_c9136b030564fc0b44a8aac252"`);
    await queryRunner.query(`DROP TABLE "payment_methods"`);
    await queryRunner.query(`DROP TYPE "public"."payment_method_type"`);
  }
}
