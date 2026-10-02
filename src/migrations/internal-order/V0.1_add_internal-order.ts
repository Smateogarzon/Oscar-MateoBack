import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddInternalOrder1790902399419 implements MigrationInterface {
  name = 'AddInternalOrder1790902399419';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`CREATE TYPE "public"."internal_order_type" AS ENUM('CUSTOMER_REQUEST', 'REPLENISHMENT', 'TRANSFER', 'RETURN', 'EXCHANGE')`);
    await queryRunner.query(`CREATE TYPE "public"."internal_order_origin" AS ENUM('SELLER', 'KIOSK', 'WAREHOUSE', 'ADMIN', 'SYSTEM')`);
    await queryRunner.query(`CREATE TYPE "public"."internal_order_status" AS ENUM('PENDING', 'ACCEPTED', 'PREPARING', 'READY', 'RUNNER_ASSIGNED', 'IN_TRANSIT', 'DELIVERED', 'RECEIVED', 'COMPLETED', 'CANCELLED')`);
    await queryRunner.query(`CREATE TABLE "internal_orders" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "companyId" uuid NOT NULL, "orderNumber" character varying(50) NOT NULL, "versionNumber" integer NOT NULL DEFAULT '1', "type" "public"."internal_order_type" NOT NULL, "origin" "public"."internal_order_origin" NOT NULL, "sourceLocationId" uuid, "destinationLocationId" uuid, "requestedBy" uuid, "warehouseOperatorId" uuid, "runnerId" uuid, "receivedBy" uuid, "status" "public"."internal_order_status" NOT NULL DEFAULT 'PENDING', "warehouseAcceptedAt" TIMESTAMP WITH TIME ZONE, "packingStartedAt" TIMESTAMP WITH TIME ZONE, "readyAt" TIMESTAMP WITH TIME ZONE, "runnerAcceptedAt" TIMESTAMP WITH TIME ZONE, "runnerPickedUpAt" TIMESTAMP WITH TIME ZONE, "deliveredAt" TIMESTAMP WITH TIME ZONE, "receivedAt" TIMESTAMP WITH TIME ZONE, "completedAt" TIMESTAMP WITH TIME ZONE, "notes" character varying(500), "cancelledAt" TIMESTAMP WITH TIME ZONE, "cancelledBy" uuid, "cancellationReason" character varying(255), CONSTRAINT "PK_c79f2ba4944ca0d2d0d7e9fa754" PRIMARY KEY ("id"))`);
    await queryRunner.query(`CREATE INDEX "IDX_f916897d70fc0f80633a83ef75" ON "internal_orders"  ("companyId") `);
    await queryRunner.query(`CREATE INDEX "IDX_dbac559c4fcada789fd03d2927" ON "internal_orders"  ("runnerId") `);
    await queryRunner.query(`CREATE INDEX "IDX_42e55bfef55cf1adf7dc00b782" ON "internal_orders"  ("status") `);
    await queryRunner.query(`CREATE INDEX "IDX_d38eed2885a268fd36d8c0083e" ON "internal_orders"  ("companyId", "status") `);
    await queryRunner.query(`CREATE UNIQUE INDEX "IDX_295b32aba6c0477855b06abd07" ON "internal_orders"  ("companyId", "orderNumber", "versionNumber") `);
    await queryRunner.query(`CREATE TABLE "internal_order_items" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "internalOrderId" uuid NOT NULL, "productVariantId" uuid NOT NULL, "quantity" numeric(12,2) NOT NULL, "foundQuantity" numeric(12,2), "incidentId" uuid, "unitPrice" numeric(14,2), "discountAmount" numeric(14,2) NOT NULL DEFAULT '0', "notes" character varying(255), CONSTRAINT "PK_980ac189a3dee69b9bd78e4adfe" PRIMARY KEY ("id"))`);
    await queryRunner.query(`CREATE INDEX "IDX_79c1603893edf5110fdecb4e25" ON "internal_order_items"  ("productVariantId") `);
    await queryRunner.query(`CREATE INDEX "IDX_b15f9ea3abbcc1e251a2bef78b" ON "internal_order_items"  ("internalOrderId") `);
    await queryRunner.query(`ALTER TABLE "internal_orders" ADD CONSTRAINT "FK_f916897d70fc0f80633a83ef755" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`);
    await queryRunner.query(`ALTER TABLE "internal_orders" ADD CONSTRAINT "FK_4126389f82891d80eea0fd5dacf" FOREIGN KEY ("sourceLocationId") REFERENCES "locations"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`);
    await queryRunner.query(`ALTER TABLE "internal_orders" ADD CONSTRAINT "FK_9d8b966f058cac8cbbb4be94233" FOREIGN KEY ("destinationLocationId") REFERENCES "locations"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`);
    await queryRunner.query(`ALTER TABLE "internal_orders" ADD CONSTRAINT "FK_a6e6ac1b739c996bbe3a02a9d75" FOREIGN KEY ("requestedBy") REFERENCES "users"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`);
    await queryRunner.query(`ALTER TABLE "internal_orders" ADD CONSTRAINT "FK_3c494b7effd21f3525e4f02a9c3" FOREIGN KEY ("warehouseOperatorId") REFERENCES "users"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`);
    await queryRunner.query(`ALTER TABLE "internal_orders" ADD CONSTRAINT "FK_dbac559c4fcada789fd03d2927b" FOREIGN KEY ("runnerId") REFERENCES "users"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`);
    await queryRunner.query(`ALTER TABLE "internal_orders" ADD CONSTRAINT "FK_b961f03c0967014f1b6fdbc3b25" FOREIGN KEY ("receivedBy") REFERENCES "users"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`);
    await queryRunner.query(`ALTER TABLE "internal_orders" ADD CONSTRAINT "FK_ab9b0c466a8ab862aa52ce8c9b3" FOREIGN KEY ("cancelledBy") REFERENCES "users"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`);
    await queryRunner.query(`ALTER TABLE "internal_order_items" ADD CONSTRAINT "FK_b15f9ea3abbcc1e251a2bef78b3" FOREIGN KEY ("internalOrderId") REFERENCES "internal_orders"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`);
    await queryRunner.query(`ALTER TABLE "internal_order_items" ADD CONSTRAINT "FK_79c1603893edf5110fdecb4e253" FOREIGN KEY ("productVariantId") REFERENCES "product_variants"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`);
    await queryRunner.query(`ALTER TABLE "internal_order_items" ADD CONSTRAINT "FK_cec821ddb87e798bcff1c3cc95b" FOREIGN KEY ("incidentId") REFERENCES "incidents"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "internal_order_items" DROP CONSTRAINT "FK_cec821ddb87e798bcff1c3cc95b"`);
    await queryRunner.query(`ALTER TABLE "internal_order_items" DROP CONSTRAINT "FK_79c1603893edf5110fdecb4e253"`);
    await queryRunner.query(`ALTER TABLE "internal_order_items" DROP CONSTRAINT "FK_b15f9ea3abbcc1e251a2bef78b3"`);
    await queryRunner.query(`ALTER TABLE "internal_orders" DROP CONSTRAINT "FK_ab9b0c466a8ab862aa52ce8c9b3"`);
    await queryRunner.query(`ALTER TABLE "internal_orders" DROP CONSTRAINT "FK_b961f03c0967014f1b6fdbc3b25"`);
    await queryRunner.query(`ALTER TABLE "internal_orders" DROP CONSTRAINT "FK_dbac559c4fcada789fd03d2927b"`);
    await queryRunner.query(`ALTER TABLE "internal_orders" DROP CONSTRAINT "FK_3c494b7effd21f3525e4f02a9c3"`);
    await queryRunner.query(`ALTER TABLE "internal_orders" DROP CONSTRAINT "FK_a6e6ac1b739c996bbe3a02a9d75"`);
    await queryRunner.query(`ALTER TABLE "internal_orders" DROP CONSTRAINT "FK_9d8b966f058cac8cbbb4be94233"`);
    await queryRunner.query(`ALTER TABLE "internal_orders" DROP CONSTRAINT "FK_4126389f82891d80eea0fd5dacf"`);
    await queryRunner.query(`ALTER TABLE "internal_orders" DROP CONSTRAINT "FK_f916897d70fc0f80633a83ef755"`);
    await queryRunner.query(`DROP INDEX "public"."IDX_b15f9ea3abbcc1e251a2bef78b"`);
    await queryRunner.query(`DROP INDEX "public"."IDX_79c1603893edf5110fdecb4e25"`);
    await queryRunner.query(`DROP TABLE "internal_order_items"`);
    await queryRunner.query(`DROP INDEX "public"."IDX_295b32aba6c0477855b06abd07"`);
    await queryRunner.query(`DROP INDEX "public"."IDX_d38eed2885a268fd36d8c0083e"`);
    await queryRunner.query(`DROP INDEX "public"."IDX_42e55bfef55cf1adf7dc00b782"`);
    await queryRunner.query(`DROP INDEX "public"."IDX_dbac559c4fcada789fd03d2927"`);
    await queryRunner.query(`DROP INDEX "public"."IDX_f916897d70fc0f80633a83ef75"`);
    await queryRunner.query(`DROP TABLE "internal_orders"`);
    await queryRunner.query(`DROP TYPE "public"."internal_order_status"`);
    await queryRunner.query(`DROP TYPE "public"."internal_order_origin"`);
    await queryRunner.query(`DROP TYPE "public"."internal_order_type"`);
  }
}
