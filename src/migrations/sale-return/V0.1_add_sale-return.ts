import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddSaleReturn1789955294206 implements MigrationInterface {
  name = 'AddSaleReturn1789955294206';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`CREATE TYPE "public"."sale_return_resolution" AS ENUM('REFUND', 'EXCHANGE', 'PARTIAL_REFUND')`);
    await queryRunner.query(`CREATE TYPE "public"."sale_return_status" AS ENUM('PENDING', 'APPROVED', 'COMPLETED', 'REJECTED', 'CANCELLED')`);
    await queryRunner.query(`CREATE TABLE "sale_returns" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "companyId" uuid NOT NULL, "saleId" uuid NOT NULL, "returnNumber" character varying(50) NOT NULL, "resolution" "public"."sale_return_resolution" NOT NULL, "replacementSaleId" uuid, "totalReturned" numeric(14,2) NOT NULL, "refundAmount" numeric(14,2) NOT NULL DEFAULT '0', "status" "public"."sale_return_status" NOT NULL DEFAULT 'PENDING', "reason" character varying(255), "processedBy" uuid NOT NULL, "resolvedBy" uuid, "resolvedAt" TIMESTAMP WITH TIME ZONE, "resolutionNotes" character varying(255), "completedAt" TIMESTAMP WITH TIME ZONE, CONSTRAINT "PK_0dacb97f81ef1ca47f61409f844" PRIMARY KEY ("id"))`);
    await queryRunner.query(`CREATE INDEX "IDX_52c9b5e9a95552d30bbc7bdcb0" ON "sale_returns"  ("companyId") `);
    await queryRunner.query(`CREATE INDEX "IDX_0f89a207a12015c14c5fc3e4df" ON "sale_returns"  ("saleId") `);
    await queryRunner.query(`CREATE INDEX "IDX_47996e4d5d3bb4ebb670b4036b" ON "sale_returns"  ("replacementSaleId") `);
    await queryRunner.query(`CREATE INDEX "IDX_f1fcc000ad66beb9da157d5c4b" ON "sale_returns"  ("status") `);
    await queryRunner.query(`CREATE UNIQUE INDEX "IDX_e215a50e1b7e50ae5ed9161f56" ON "sale_returns"  ("companyId", "returnNumber") `);
    await queryRunner.query(`CREATE TABLE "refund_payments" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "saleReturnId" uuid NOT NULL, "paymentMethodId" uuid NOT NULL, "amount" numeric(14,2) NOT NULL, "reference" character varying(120), "cashSessionId" uuid, "paidBy" uuid NOT NULL, CONSTRAINT "PK_db53cfd27f412535c4eb492d466" PRIMARY KEY ("id"))`);
    await queryRunner.query(`CREATE INDEX "IDX_944f13a9eb25054e65ddab2e0f" ON "refund_payments"  ("saleReturnId") `);
    await queryRunner.query(`CREATE INDEX "IDX_4dd090107a915258bdab9f438a" ON "refund_payments"  ("paymentMethodId") `);
    await queryRunner.query(`CREATE INDEX "IDX_9dba42c1ae75ebcf55141fc14c" ON "refund_payments"  ("cashSessionId") `);
    await queryRunner.query(`CREATE TABLE "sale_return_items" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "saleReturnId" uuid NOT NULL, "saleItemId" uuid NOT NULL, "quantity" numeric(12,2) NOT NULL, "amount" numeric(14,2) NOT NULL, CONSTRAINT "PK_87c0813662620cbb412d65c0cc4" PRIMARY KEY ("id"))`);
    await queryRunner.query(`CREATE INDEX "IDX_7a4cc0fc041464ffff1aa2b03b" ON "sale_return_items"  ("saleItemId") `);
    await queryRunner.query(`CREATE UNIQUE INDEX "IDX_0569e58e53e8d36deaa997dc61" ON "sale_return_items"  ("saleReturnId", "saleItemId") `);
    await queryRunner.query(`ALTER TABLE "sale_returns" ADD CONSTRAINT "FK_52c9b5e9a95552d30bbc7bdcb0f" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`);
    await queryRunner.query(`ALTER TABLE "sale_returns" ADD CONSTRAINT "FK_0f89a207a12015c14c5fc3e4df0" FOREIGN KEY ("saleId") REFERENCES "sales"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`);
    await queryRunner.query(`ALTER TABLE "sale_returns" ADD CONSTRAINT "FK_47996e4d5d3bb4ebb670b4036bd" FOREIGN KEY ("replacementSaleId") REFERENCES "sales"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`);
    await queryRunner.query(`ALTER TABLE "sale_returns" ADD CONSTRAINT "FK_577ee808cb6e4fea41fe8e32353" FOREIGN KEY ("processedBy") REFERENCES "users"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`);
    await queryRunner.query(`ALTER TABLE "sale_returns" ADD CONSTRAINT "FK_6ab8ed700281dd187317895dc7e" FOREIGN KEY ("resolvedBy") REFERENCES "users"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`);
    await queryRunner.query(`ALTER TABLE "refund_payments" ADD CONSTRAINT "FK_944f13a9eb25054e65ddab2e0f4" FOREIGN KEY ("saleReturnId") REFERENCES "sale_returns"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`);
    await queryRunner.query(`ALTER TABLE "refund_payments" ADD CONSTRAINT "FK_4dd090107a915258bdab9f438ae" FOREIGN KEY ("paymentMethodId") REFERENCES "payment_methods"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`);
    await queryRunner.query(`ALTER TABLE "refund_payments" ADD CONSTRAINT "FK_9dba42c1ae75ebcf55141fc14c0" FOREIGN KEY ("cashSessionId") REFERENCES "cash_sessions"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`);
    await queryRunner.query(`ALTER TABLE "refund_payments" ADD CONSTRAINT "FK_00d3c903f3782353843975f8e20" FOREIGN KEY ("paidBy") REFERENCES "users"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`);
    await queryRunner.query(`ALTER TABLE "sale_return_items" ADD CONSTRAINT "FK_b3c0ce7bdc39fb898c63b24c7b8" FOREIGN KEY ("saleReturnId") REFERENCES "sale_returns"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`);
    await queryRunner.query(`ALTER TABLE "sale_return_items" ADD CONSTRAINT "FK_7a4cc0fc041464ffff1aa2b03b1" FOREIGN KEY ("saleItemId") REFERENCES "sale_items"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "sale_return_items" DROP CONSTRAINT "FK_7a4cc0fc041464ffff1aa2b03b1"`);
    await queryRunner.query(`ALTER TABLE "sale_return_items" DROP CONSTRAINT "FK_b3c0ce7bdc39fb898c63b24c7b8"`);
    await queryRunner.query(`ALTER TABLE "refund_payments" DROP CONSTRAINT "FK_00d3c903f3782353843975f8e20"`);
    await queryRunner.query(`ALTER TABLE "refund_payments" DROP CONSTRAINT "FK_9dba42c1ae75ebcf55141fc14c0"`);
    await queryRunner.query(`ALTER TABLE "refund_payments" DROP CONSTRAINT "FK_4dd090107a915258bdab9f438ae"`);
    await queryRunner.query(`ALTER TABLE "refund_payments" DROP CONSTRAINT "FK_944f13a9eb25054e65ddab2e0f4"`);
    await queryRunner.query(`ALTER TABLE "sale_returns" DROP CONSTRAINT "FK_6ab8ed700281dd187317895dc7e"`);
    await queryRunner.query(`ALTER TABLE "sale_returns" DROP CONSTRAINT "FK_577ee808cb6e4fea41fe8e32353"`);
    await queryRunner.query(`ALTER TABLE "sale_returns" DROP CONSTRAINT "FK_47996e4d5d3bb4ebb670b4036bd"`);
    await queryRunner.query(`ALTER TABLE "sale_returns" DROP CONSTRAINT "FK_0f89a207a12015c14c5fc3e4df0"`);
    await queryRunner.query(`ALTER TABLE "sale_returns" DROP CONSTRAINT "FK_52c9b5e9a95552d30bbc7bdcb0f"`);
    await queryRunner.query(`DROP INDEX "public"."IDX_0569e58e53e8d36deaa997dc61"`);
    await queryRunner.query(`DROP INDEX "public"."IDX_7a4cc0fc041464ffff1aa2b03b"`);
    await queryRunner.query(`DROP TABLE "sale_return_items"`);
    await queryRunner.query(`DROP INDEX "public"."IDX_9dba42c1ae75ebcf55141fc14c"`);
    await queryRunner.query(`DROP INDEX "public"."IDX_4dd090107a915258bdab9f438a"`);
    await queryRunner.query(`DROP INDEX "public"."IDX_944f13a9eb25054e65ddab2e0f"`);
    await queryRunner.query(`DROP TABLE "refund_payments"`);
    await queryRunner.query(`DROP INDEX "public"."IDX_e215a50e1b7e50ae5ed9161f56"`);
    await queryRunner.query(`DROP INDEX "public"."IDX_f1fcc000ad66beb9da157d5c4b"`);
    await queryRunner.query(`DROP INDEX "public"."IDX_47996e4d5d3bb4ebb670b4036b"`);
    await queryRunner.query(`DROP INDEX "public"."IDX_0f89a207a12015c14c5fc3e4df"`);
    await queryRunner.query(`DROP INDEX "public"."IDX_52c9b5e9a95552d30bbc7bdcb0"`);
    await queryRunner.query(`DROP TABLE "sale_returns"`);
    await queryRunner.query(`DROP TYPE "public"."sale_return_status"`);
    await queryRunner.query(`DROP TYPE "public"."sale_return_resolution"`);
  }
}
