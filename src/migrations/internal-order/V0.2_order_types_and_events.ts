import { MigrationInterface, QueryRunner } from 'typeorm';
import { assertDestructiveDownAllowed } from '../../config/destructive-down.js';
import { AddInternalOrder1790902399419 } from './V0.1_add_internal-order.js';

// Rehace los pedidos internos con el modelo de órdenes del diseño: tipos SO/RE/TR/RS con su propio
// flujo y consecutivo, una fila estable por orden con sus versiones aparte, la bitácora de eventos
// (de donde salen los tiempos y el recorrido), las correcciones por error de alistamiento y la FK de
// la venta que cobra una SO. Las tablas del modelo anterior se reemplazan: solo se puede si todavía
// no hay ningún pedido guardado (no hay cómo convertir PENDING/READY/... a los flujos por tipo).
export class OrderTypesAndEvents1791900000010 implements MigrationInterface {
  name = 'OrderTypesAndEvents1791900000010';

  public async up(queryRunner: QueryRunner): Promise<void> {
    const [{ count }] = (await queryRunner.query(`SELECT COUNT(*)::int AS "count" FROM "internal_orders"`)) as {
      count: number;
    }[];
    if (count > 0) {
      throw new Error(
        `Hay ${count} pedidos internos guardados con el modelo anterior: esta migración reemplaza sus tablas y no puede convertirlos. Respáldalos y bórralos antes de correrla.`,
      );
    }

    // Fuera el modelo anterior (ya se comprobó vacío: no se pierde nada).
    await queryRunner.query(`DROP TABLE "internal_order_items"`);
    await queryRunner.query(`DROP TABLE "internal_orders"`);
    await queryRunner.query(`DROP TYPE "public"."internal_order_status"`);
    await queryRunner.query(`DROP TYPE "public"."internal_order_origin"`);
    await queryRunner.query(`DROP TYPE "public"."internal_order_type"`);

    await queryRunner.query(`CREATE TYPE "public"."internal_order_type" AS ENUM('SO', 'RE', 'TR', 'RS')`);
    await queryRunner.query(`CREATE TYPE "public"."internal_order_origin" AS ENUM('SELLER', 'KIOSK', 'WAREHOUSE', 'ADMIN', 'SYSTEM')`);
    await queryRunner.query(`CREATE TYPE "public"."internal_order_priority" AS ENUM('NORMAL', 'HIGH')`);
    await queryRunner.query(
      `CREATE TYPE "public"."internal_order_status" AS ENUM('NEW', 'ACCEPTED_BY_WAREHOUSE', 'PACKING', 'READY_FOR_RUNNER', 'IN_TRANSIT', 'DELIVERED_TO_STORE', 'RECEIVED_BY_SELLER', 'PENDING_PAYMENT', 'PAID', 'RETURN_REQUESTED', 'ITEM_CHANGE_REQUESTED', 'MERGED_INTO_PARENT', 'RETURN_CREATED', 'WAITING_FOR_RUNNER', 'IN_TRANSIT_TO_WAREHOUSE', 'DELIVERED_TO_WAREHOUSE', 'RECEIVED_BY_WAREHOUSE', 'RETURNED', 'TRANSFER_REQUESTED', 'DELIVERED_TO_DESTINATION', 'RECEIVED_BY_DESTINATION', 'TRANSFERRED', 'RESTOCK_REQUESTED', 'RECEIVED_BY_STORE', 'RESTOCKED', 'CANCELLED')`,
    );
    await queryRunner.query(`CREATE TYPE "public"."internal_order_event_kind" AS ENUM('STATUS', 'VERSION', 'CORRECTION', 'NUDGE', 'NOTE')`);

    await queryRunner.query(`CREATE TABLE "internal_orders" (
      "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
      "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
      "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
      "companyId" uuid NOT NULL,
      "orderNumber" character varying(50) NOT NULL,
      "versionNumber" integer NOT NULL DEFAULT 1,
      "type" "public"."internal_order_type" NOT NULL,
      "origin" "public"."internal_order_origin" NOT NULL,
      "priority" "public"."internal_order_priority" NOT NULL DEFAULT 'NORMAL',
      "status" "public"."internal_order_status" NOT NULL,
      "statusChangedAt" TIMESTAMP WITH TIME ZONE NOT NULL,
      "sourceLocationId" uuid NOT NULL,
      "destinationLocationId" uuid NOT NULL,
      "deliveryPoint" character varying(80),
      "requestedBy" uuid,
      "warehouseOperatorId" uuid,
      "runnerId" uuid,
      "receivedBy" uuid,
      "parentOrderId" uuid,
      "relatedOrderId" uuid,
      "saleId" uuid,
      "notes" character varying(500),
      "cancelledAt" TIMESTAMP WITH TIME ZONE,
      "cancelledBy" uuid,
      "cancellationReason" character varying(255),
      CONSTRAINT "PK_internal_orders" PRIMARY KEY ("id"),
      CONSTRAINT "CHK_internal_orders_route" CHECK ("sourceLocationId" <> "destinationLocationId")
    )`);
    await queryRunner.query(`CREATE UNIQUE INDEX "IDX_internal_orders_number" ON "internal_orders" ("companyId", "orderNumber")`);
    await queryRunner.query(`CREATE INDEX "IDX_internal_orders_company" ON "internal_orders" ("companyId")`);
    await queryRunner.query(`CREATE INDEX "IDX_internal_orders_company_status" ON "internal_orders" ("companyId", "status")`);
    await queryRunner.query(`CREATE INDEX "IDX_internal_orders_company_type" ON "internal_orders" ("companyId", "type")`);
    await queryRunner.query(`CREATE INDEX "IDX_internal_orders_status" ON "internal_orders" ("status")`);
    await queryRunner.query(`CREATE INDEX "IDX_internal_orders_runner" ON "internal_orders" ("runnerId")`);
    await queryRunner.query(`CREATE INDEX "IDX_internal_orders_parent" ON "internal_orders" ("parentOrderId")`);
    await queryRunner.query(`CREATE INDEX "IDX_internal_orders_related" ON "internal_orders" ("relatedOrderId")`);

    await queryRunner.query(`CREATE TABLE "internal_order_items" (
      "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
      "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
      "internalOrderId" uuid NOT NULL,
      "versionNumber" integer NOT NULL,
      "productVariantId" uuid NOT NULL,
      "quantity" numeric(12,2) NOT NULL,
      "foundQuantity" numeric(12,2),
      "incidentId" uuid,
      "unitPrice" numeric(14,2),
      "discountAmount" numeric(14,2) NOT NULL DEFAULT 0,
      "notes" character varying(255),
      CONSTRAINT "PK_internal_order_items" PRIMARY KEY ("id"),
      CONSTRAINT "CHK_internal_order_items_quantity" CHECK ("quantity" > 0),
      CONSTRAINT "CHK_internal_order_items_found" CHECK ("foundQuantity" IS NULL OR "foundQuantity" >= 0)
    )`);
    await queryRunner.query(`CREATE INDEX "IDX_internal_order_items_version" ON "internal_order_items" ("internalOrderId", "versionNumber")`);
    await queryRunner.query(`CREATE INDEX "IDX_internal_order_items_variant" ON "internal_order_items" ("productVariantId")`);

    await queryRunner.query(`CREATE TABLE "internal_order_versions" (
      "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
      "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
      "internalOrderId" uuid NOT NULL,
      "versionNumber" integer NOT NULL,
      "reason" character varying(255) NOT NULL,
      "createdBy" uuid,
      "sourceLocationId" uuid NOT NULL,
      CONSTRAINT "PK_internal_order_versions" PRIMARY KEY ("id")
    )`);
    await queryRunner.query(`CREATE UNIQUE INDEX "IDX_internal_order_versions_number" ON "internal_order_versions" ("internalOrderId", "versionNumber")`);

    await queryRunner.query(`CREATE TABLE "internal_order_events" (
      "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
      "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
      "internalOrderId" uuid NOT NULL,
      "versionNumber" integer NOT NULL,
      "kind" "public"."internal_order_event_kind" NOT NULL,
      "fromStatus" "public"."internal_order_status",
      "toStatus" "public"."internal_order_status",
      "locationId" uuid,
      "actorId" uuid,
      "detail" character varying(500) NOT NULL,
      CONSTRAINT "PK_internal_order_events" PRIMARY KEY ("id")
    )`);
    await queryRunner.query(`CREATE INDEX "IDX_internal_order_events_order" ON "internal_order_events" ("internalOrderId", "createdAt")`);

    await queryRunner.query(`CREATE TABLE "internal_order_corrections" (
      "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
      "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
      "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
      "internalOrderId" uuid NOT NULL,
      "versionNumber" integer NOT NULL,
      "description" character varying(500) NOT NULL,
      "reportedBy" uuid NOT NULL,
      "runnerId" uuid,
      "step" integer NOT NULL DEFAULT 0,
      "arrivedAtWarehouseAt" TIMESTAMP WITH TIME ZONE,
      "leftWarehouseAt" TIMESTAMP WITH TIME ZONE,
      "closedAt" TIMESTAMP WITH TIME ZONE,
      "incidentId" uuid,
      CONSTRAINT "PK_internal_order_corrections" PRIMARY KEY ("id"),
      CONSTRAINT "CHK_internal_order_corrections_step" CHECK ("step" BETWEEN 0 AND 3)
    )`);
    await queryRunner.query(`CREATE INDEX "IDX_internal_order_corrections_order" ON "internal_order_corrections" ("internalOrderId")`);

    const fk = (table: string, name: string, column: string, target: string) =>
      queryRunner.query(
        `ALTER TABLE "${table}" ADD CONSTRAINT "${name}" FOREIGN KEY ("${column}") REFERENCES "${target}"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`,
      );
    await fk('internal_orders', 'FK_internal_orders_company', 'companyId', 'companies');
    await fk('internal_orders', 'FK_internal_orders_source', 'sourceLocationId', 'locations');
    await fk('internal_orders', 'FK_internal_orders_destination', 'destinationLocationId', 'locations');
    await fk('internal_orders', 'FK_internal_orders_requested_by', 'requestedBy', 'users');
    await fk('internal_orders', 'FK_internal_orders_operator', 'warehouseOperatorId', 'users');
    await fk('internal_orders', 'FK_internal_orders_runner', 'runnerId', 'users');
    await fk('internal_orders', 'FK_internal_orders_received_by', 'receivedBy', 'users');
    await fk('internal_orders', 'FK_internal_orders_cancelled_by', 'cancelledBy', 'users');
    await fk('internal_orders', 'FK_internal_orders_parent', 'parentOrderId', 'internal_orders');
    await fk('internal_orders', 'FK_internal_orders_related', 'relatedOrderId', 'internal_orders');
    await fk('internal_orders', 'FK_internal_orders_sale', 'saleId', 'sales');
    await fk('internal_order_items', 'FK_internal_order_items_order', 'internalOrderId', 'internal_orders');
    await fk('internal_order_items', 'FK_internal_order_items_variant', 'productVariantId', 'product_variants');
    await fk('internal_order_items', 'FK_internal_order_items_incident', 'incidentId', 'incidents');
    await fk('internal_order_versions', 'FK_internal_order_versions_order', 'internalOrderId', 'internal_orders');
    await fk('internal_order_versions', 'FK_internal_order_versions_created_by', 'createdBy', 'users');
    await fk('internal_order_versions', 'FK_internal_order_versions_source', 'sourceLocationId', 'locations');
    await fk('internal_order_events', 'FK_internal_order_events_order', 'internalOrderId', 'internal_orders');
    await fk('internal_order_events', 'FK_internal_order_events_location', 'locationId', 'locations');
    await fk('internal_order_events', 'FK_internal_order_events_actor', 'actorId', 'users');
    await fk('internal_order_corrections', 'FK_internal_order_corrections_order', 'internalOrderId', 'internal_orders');
    await fk('internal_order_corrections', 'FK_internal_order_corrections_reported_by', 'reportedBy', 'users');
    await fk('internal_order_corrections', 'FK_internal_order_corrections_runner', 'runnerId', 'users');
    await fk('internal_order_corrections', 'FK_internal_order_corrections_incident', 'incidentId', 'incidents');

    // La venta que cobra una SO: la columna existía desde la primera migración de ventas, esperando
    // esta tabla para su FK.
    await queryRunner.query(`UPDATE "sales" SET "internalOrderId" = NULL WHERE "internalOrderId" IS NOT NULL`);
    await fk('sales', 'FK_sales_internal_order', 'internalOrderId', 'internal_orders');
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    assertDestructiveDownAllowed(this.name);
    await queryRunner.query(`ALTER TABLE "sales" DROP CONSTRAINT "FK_sales_internal_order"`);
    await queryRunner.query(`DROP TABLE "internal_order_corrections"`);
    await queryRunner.query(`DROP TABLE "internal_order_events"`);
    await queryRunner.query(`DROP TABLE "internal_order_versions"`);
    await queryRunner.query(`DROP TABLE "internal_order_items"`);
    await queryRunner.query(`DROP TABLE "internal_orders"`);
    await queryRunner.query(`DROP TYPE "public"."internal_order_event_kind"`);
    await queryRunner.query(`DROP TYPE "public"."internal_order_status"`);
    await queryRunner.query(`DROP TYPE "public"."internal_order_priority"`);
    await queryRunner.query(`DROP TYPE "public"."internal_order_origin"`);
    await queryRunner.query(`DROP TYPE "public"."internal_order_type"`);
    await new AddInternalOrder1790902399419().up(queryRunner);
  }
}
