import { MigrationInterface, QueryRunner } from 'typeorm';
import { assertDestructiveDownAllowed } from '../../config/destructive-down.js';

export class AddDiscountRequest1789922366462 implements MigrationInterface {
  name = 'AddDiscountRequest1789922366462';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`CREATE TYPE "public"."discount_request_status" AS ENUM('PENDING', 'APPROVED', 'REJECTED', 'CANCELLED')`);
    await queryRunner.query(`CREATE TABLE "discount_requests" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "saleId" uuid NOT NULL, "requestedBy" uuid NOT NULL, "resolvedBy" uuid, "requestedDiscount" numeric(14,2) NOT NULL, "approvedDiscount" numeric(14,2), "reason" character varying(255), "resolutionNotes" character varying(255), "status" "public"."discount_request_status" NOT NULL DEFAULT 'PENDING', "requestedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "resolvedAt" TIMESTAMP WITH TIME ZONE, CONSTRAINT "PK_2a11f0671840a26f699f066f7b0" PRIMARY KEY ("id"))`);
    await queryRunner.query(`CREATE INDEX "IDX_25a46238fa4ace8af4f8969c9e" ON "discount_requests"  ("saleId") `);
    await queryRunner.query(`CREATE INDEX "IDX_71f1a4507d92adba9c90e92f31" ON "discount_requests"  ("status") `);
    await queryRunner.query(`CREATE UNIQUE INDEX "IDX_c93d1fd384f8ef13bd99341281" ON "discount_requests"  ("saleId") WHERE "status" IN ('PENDING', 'APPROVED')`);
    await queryRunner.query(`CREATE TABLE "discount_request_items" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "discountRequestId" uuid NOT NULL, "saleItemId" uuid NOT NULL, "requestedDiscount" numeric(14,2) NOT NULL, "approvedDiscount" numeric(14,2), CONSTRAINT "PK_7df15d6074f4de230fb1463f5c2" PRIMARY KEY ("id"))`);
    await queryRunner.query(`CREATE INDEX "IDX_61925fc4e27be3644f64edaec0" ON "discount_request_items"  ("saleItemId") `);
    await queryRunner.query(`CREATE UNIQUE INDEX "IDX_7c56b775125527e8ff9e296f4b" ON "discount_request_items"  ("discountRequestId", "saleItemId") `);
    await queryRunner.query(`ALTER TABLE "discount_requests" ADD CONSTRAINT "FK_25a46238fa4ace8af4f8969c9e9" FOREIGN KEY ("saleId") REFERENCES "sales"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`);
    await queryRunner.query(`ALTER TABLE "discount_requests" ADD CONSTRAINT "FK_23fca9e77ab49510ff915814502" FOREIGN KEY ("requestedBy") REFERENCES "users"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`);
    await queryRunner.query(`ALTER TABLE "discount_requests" ADD CONSTRAINT "FK_778e82727c285b2146854265897" FOREIGN KEY ("resolvedBy") REFERENCES "users"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`);
    await queryRunner.query(`ALTER TABLE "discount_request_items" ADD CONSTRAINT "FK_a2a6f7b86af78060c1789a7d175" FOREIGN KEY ("discountRequestId") REFERENCES "discount_requests"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`);
    await queryRunner.query(`ALTER TABLE "discount_request_items" ADD CONSTRAINT "FK_61925fc4e27be3644f64edaec0c" FOREIGN KEY ("saleItemId") REFERENCES "sale_items"("id") ON DELETE CASCADE ON UPDATE NO ACTION`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    assertDestructiveDownAllowed(this.name);
    await queryRunner.query(`ALTER TABLE "discount_request_items" DROP CONSTRAINT "FK_61925fc4e27be3644f64edaec0c"`);
    await queryRunner.query(`ALTER TABLE "discount_request_items" DROP CONSTRAINT "FK_a2a6f7b86af78060c1789a7d175"`);
    await queryRunner.query(`ALTER TABLE "discount_requests" DROP CONSTRAINT "FK_778e82727c285b2146854265897"`);
    await queryRunner.query(`ALTER TABLE "discount_requests" DROP CONSTRAINT "FK_23fca9e77ab49510ff915814502"`);
    await queryRunner.query(`ALTER TABLE "discount_requests" DROP CONSTRAINT "FK_25a46238fa4ace8af4f8969c9e9"`);
    await queryRunner.query(`DROP INDEX "public"."IDX_7c56b775125527e8ff9e296f4b"`);
    await queryRunner.query(`DROP INDEX "public"."IDX_61925fc4e27be3644f64edaec0"`);
    await queryRunner.query(`DROP TABLE "discount_request_items"`);
    await queryRunner.query(`DROP INDEX "public"."IDX_c93d1fd384f8ef13bd99341281"`);
    await queryRunner.query(`DROP INDEX "public"."IDX_71f1a4507d92adba9c90e92f31"`);
    await queryRunner.query(`DROP INDEX "public"."IDX_25a46238fa4ace8af4f8969c9e"`);
    await queryRunner.query(`DROP TABLE "discount_requests"`);
    await queryRunner.query(`DROP TYPE "public"."discount_request_status"`);
  }
}
