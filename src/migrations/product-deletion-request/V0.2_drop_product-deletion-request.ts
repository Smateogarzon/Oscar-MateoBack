import { MigrationInterface, QueryRunner } from 'typeorm';
import { assertDestructiveDownAllowed } from '../../config/destructive-down.js';

// Ya no hay solicitudes de borrado de referencia: el inventario solo lo modifica el Administrador,
// que borra directo. Se elimina la tabla (V0.1 la creó) junto con su tipo de estado.
export class DropProductDeletionRequest1791000000001 implements MigrationInterface {
  name = 'DropProductDeletionRequest1791000000001';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE "product_deletion_requests"`);
    await queryRunner.query(`DROP TYPE "public"."product_deletion_request_status"`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    assertDestructiveDownAllowed(this.name);
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
}
