import { MigrationInterface, QueryRunner } from 'typeorm';
import { assertDestructiveDownAllowed } from '../../config/destructive-down.js';

export class AddProductDeletionRequest1790900000002 implements MigrationInterface {
  name = 'AddProductDeletionRequest1790900000002';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`CREATE TYPE "public"."product_deletion_request_status" AS ENUM('PENDING', 'APPROVED', 'REJECTED', 'CANCELLED')`);
    await queryRunner.query(
      `CREATE TABLE "product_deletion_requests" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "productId" uuid NOT NULL, "requestedBy" uuid NOT NULL, "resolvedBy" uuid, "reason" character varying(255), "resolutionNotes" character varying(255), "status" "public"."product_deletion_request_status" NOT NULL DEFAULT 'PENDING', "requestedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "resolvedAt" TIMESTAMP WITH TIME ZONE, CONSTRAINT "PK_product_deletion_requests" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(`CREATE INDEX "IDX_product_deletion_requests_productId" ON "product_deletion_requests" ("productId")`);
    await queryRunner.query(`CREATE INDEX "IDX_product_deletion_requests_status" ON "product_deletion_requests" ("status")`);
    await queryRunner.query(
      `CREATE UNIQUE INDEX "IDX_product_deletion_requests_active" ON "product_deletion_requests" ("productId") WHERE "status" = 'PENDING'`,
    );
    await queryRunner.query(
      `ALTER TABLE "product_deletion_requests" ADD CONSTRAINT "FK_product_deletion_requests_product" FOREIGN KEY ("productId") REFERENCES "products"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "product_deletion_requests" ADD CONSTRAINT "FK_product_deletion_requests_requestedBy" FOREIGN KEY ("requestedBy") REFERENCES "users"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "product_deletion_requests" ADD CONSTRAINT "FK_product_deletion_requests_resolvedBy" FOREIGN KEY ("resolvedBy") REFERENCES "users"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    assertDestructiveDownAllowed(this.name);
    await queryRunner.query(`ALTER TABLE "product_deletion_requests" DROP CONSTRAINT "FK_product_deletion_requests_resolvedBy"`);
    await queryRunner.query(`ALTER TABLE "product_deletion_requests" DROP CONSTRAINT "FK_product_deletion_requests_requestedBy"`);
    await queryRunner.query(`ALTER TABLE "product_deletion_requests" DROP CONSTRAINT "FK_product_deletion_requests_product"`);
    await queryRunner.query(`DROP INDEX "public"."IDX_product_deletion_requests_active"`);
    await queryRunner.query(`DROP INDEX "public"."IDX_product_deletion_requests_status"`);
    await queryRunner.query(`DROP INDEX "public"."IDX_product_deletion_requests_productId"`);
    await queryRunner.query(`DROP TABLE "product_deletion_requests"`);
    await queryRunner.query(`DROP TYPE "public"."product_deletion_request_status"`);
  }
}
