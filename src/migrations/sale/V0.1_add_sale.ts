import { MigrationInterface, QueryRunner } from 'typeorm';
import { assertDestructiveDownAllowed } from '../../config/destructive-down.js';

export class AddSale1789918197966 implements MigrationInterface {
  name = 'AddSale1789918197966';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`CREATE TYPE "public"."sale_status" AS ENUM('DRAFT', 'COMPLETED', 'CANCELLED')`);
    await queryRunner.query(`CREATE TABLE "sales" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "companyId" uuid NOT NULL, "storeId" uuid NOT NULL, "internalOrderId" uuid, "saleNumber" character varying(50) NOT NULL, "sellerId" uuid, "cashierId" uuid NOT NULL, "cashSessionId" uuid, "subtotal" numeric(14,2) NOT NULL DEFAULT '0', "discountTotal" numeric(14,2) NOT NULL DEFAULT '0', "total" numeric(14,2) NOT NULL DEFAULT '0', "status" "public"."sale_status" NOT NULL DEFAULT 'DRAFT', "cancelledBy" uuid, "cancellationReason" character varying(255), "cancelledAt" TIMESTAMP WITH TIME ZONE, "completedAt" TIMESTAMP WITH TIME ZONE, CONSTRAINT "PK_4f0bc990ae81dba46da680895ea" PRIMARY KEY ("id"))`);
    await queryRunner.query(`CREATE INDEX "IDX_ef0e802924109a86947d4df5c9" ON "sales"  ("storeId") `);
    await queryRunner.query(`CREATE INDEX "IDX_f2e6ad03aa3b5463a5385d0116" ON "sales"  ("internalOrderId") `);
    await queryRunner.query(`CREATE INDEX "IDX_5e42712da412943bdd4e2c0861" ON "sales"  ("sellerId") `);
    await queryRunner.query(`CREATE INDEX "IDX_3b04a33c33ed9653a8a3cd316c" ON "sales"  ("cashierId") `);
    await queryRunner.query(`CREATE INDEX "IDX_b499133d93f00504df0aeccfc2" ON "sales"  ("cashSessionId") `);
    await queryRunner.query(`CREATE UNIQUE INDEX "IDX_ccd464f729acb14dfcd2179feb" ON "sales"  ("companyId", "saleNumber") `);
    await queryRunner.query(`ALTER TABLE "sales" ADD CONSTRAINT "FK_c613a0c4a8c642c09d29ebcbf55" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`);
    await queryRunner.query(`ALTER TABLE "sales" ADD CONSTRAINT "FK_ef0e802924109a86947d4df5c9e" FOREIGN KEY ("storeId") REFERENCES "locations"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`);
    await queryRunner.query(`ALTER TABLE "sales" ADD CONSTRAINT "FK_5e42712da412943bdd4e2c08617" FOREIGN KEY ("sellerId") REFERENCES "users"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`);
    await queryRunner.query(`ALTER TABLE "sales" ADD CONSTRAINT "FK_3b04a33c33ed9653a8a3cd316c5" FOREIGN KEY ("cashierId") REFERENCES "users"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`);
    await queryRunner.query(`ALTER TABLE "sales" ADD CONSTRAINT "FK_9347e2e87528ed61c5123c45be2" FOREIGN KEY ("cancelledBy") REFERENCES "users"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    assertDestructiveDownAllowed(this.name);
    await queryRunner.query(`ALTER TABLE "sales" DROP CONSTRAINT "FK_9347e2e87528ed61c5123c45be2"`);
    await queryRunner.query(`ALTER TABLE "sales" DROP CONSTRAINT "FK_3b04a33c33ed9653a8a3cd316c5"`);
    await queryRunner.query(`ALTER TABLE "sales" DROP CONSTRAINT "FK_5e42712da412943bdd4e2c08617"`);
    await queryRunner.query(`ALTER TABLE "sales" DROP CONSTRAINT "FK_ef0e802924109a86947d4df5c9e"`);
    await queryRunner.query(`ALTER TABLE "sales" DROP CONSTRAINT "FK_c613a0c4a8c642c09d29ebcbf55"`);
    await queryRunner.query(`DROP INDEX "public"."IDX_ccd464f729acb14dfcd2179feb"`);
    await queryRunner.query(`DROP INDEX "public"."IDX_b499133d93f00504df0aeccfc2"`);
    await queryRunner.query(`DROP INDEX "public"."IDX_3b04a33c33ed9653a8a3cd316c"`);
    await queryRunner.query(`DROP INDEX "public"."IDX_5e42712da412943bdd4e2c0861"`);
    await queryRunner.query(`DROP INDEX "public"."IDX_f2e6ad03aa3b5463a5385d0116"`);
    await queryRunner.query(`DROP INDEX "public"."IDX_ef0e802924109a86947d4df5c9"`);
    await queryRunner.query(`DROP TABLE "sales"`);
    await queryRunner.query(`DROP TYPE "public"."sale_status"`);
  }
}
