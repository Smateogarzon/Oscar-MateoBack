import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddPurchaseOrder1790902399421 implements MigrationInterface {
  name = 'AddPurchaseOrder1790902399421';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`CREATE TYPE "public"."purchase_order_status" AS ENUM('DRAFT', 'SENT', 'CONFIRMED', 'PARTIALLY_RECEIVED', 'RECEIVED', 'CANCELLED')`);
    await queryRunner.query(`CREATE TABLE "purchase_orders" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "companyId" uuid NOT NULL, "supplierId" uuid NOT NULL, "orderNumber" character varying(50) NOT NULL, "destinationLocationId" uuid NOT NULL, "status" "public"."purchase_order_status" NOT NULL DEFAULT 'DRAFT', "subtotal" numeric(14,2) NOT NULL DEFAULT '0', "total" numeric(14,2) NOT NULL DEFAULT '0', "expectedAt" TIMESTAMP WITH TIME ZONE, "notes" character varying(500), "createdBy" uuid NOT NULL, "confirmedAt" TIMESTAMP WITH TIME ZONE, "receivedAt" TIMESTAMP WITH TIME ZONE, "cancelledAt" TIMESTAMP WITH TIME ZONE, "cancelledBy" uuid, "cancellationReason" character varying(255), CONSTRAINT "PK_05148947415204a897e8beb2553" PRIMARY KEY ("id"))`);
    await queryRunner.query(`CREATE INDEX "IDX_4b81cf5bd28a3d146d7585f3a5" ON "purchase_orders"  ("companyId") `);
    await queryRunner.query(`CREATE INDEX "IDX_0c3ff892a9f2ed16f59d31ccca" ON "purchase_orders"  ("supplierId") `);
    await queryRunner.query(`CREATE INDEX "IDX_5a417c21ec2ad2bf6c1758cf18" ON "purchase_orders"  ("destinationLocationId") `);
    await queryRunner.query(`CREATE INDEX "IDX_5272ac3aa931eedb14cd8789d6" ON "purchase_orders"  ("status") `);
    await queryRunner.query(`CREATE UNIQUE INDEX "IDX_4a84524995fc0bca69ba697264" ON "purchase_orders"  ("companyId", "orderNumber") `);
    await queryRunner.query(`ALTER TABLE "purchase_orders" ADD CONSTRAINT "FK_4b81cf5bd28a3d146d7585f3a55" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`);
    await queryRunner.query(`ALTER TABLE "purchase_orders" ADD CONSTRAINT "FK_0c3ff892a9f2ed16f59d31cccae" FOREIGN KEY ("supplierId") REFERENCES "users"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`);
    await queryRunner.query(`ALTER TABLE "purchase_orders" ADD CONSTRAINT "FK_5a417c21ec2ad2bf6c1758cf185" FOREIGN KEY ("destinationLocationId") REFERENCES "locations"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`);
    await queryRunner.query(`ALTER TABLE "purchase_orders" ADD CONSTRAINT "FK_c373026da3848c1742a3b38cf71" FOREIGN KEY ("createdBy") REFERENCES "users"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`);
    await queryRunner.query(`ALTER TABLE "purchase_orders" ADD CONSTRAINT "FK_f1284168fa0db85f9b5c9d86756" FOREIGN KEY ("cancelledBy") REFERENCES "users"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "purchase_orders" DROP CONSTRAINT "FK_f1284168fa0db85f9b5c9d86756"`);
    await queryRunner.query(`ALTER TABLE "purchase_orders" DROP CONSTRAINT "FK_c373026da3848c1742a3b38cf71"`);
    await queryRunner.query(`ALTER TABLE "purchase_orders" DROP CONSTRAINT "FK_5a417c21ec2ad2bf6c1758cf185"`);
    await queryRunner.query(`ALTER TABLE "purchase_orders" DROP CONSTRAINT "FK_0c3ff892a9f2ed16f59d31cccae"`);
    await queryRunner.query(`ALTER TABLE "purchase_orders" DROP CONSTRAINT "FK_4b81cf5bd28a3d146d7585f3a55"`);
    await queryRunner.query(`DROP INDEX "public"."IDX_4a84524995fc0bca69ba697264"`);
    await queryRunner.query(`DROP INDEX "public"."IDX_5272ac3aa931eedb14cd8789d6"`);
    await queryRunner.query(`DROP INDEX "public"."IDX_5a417c21ec2ad2bf6c1758cf18"`);
    await queryRunner.query(`DROP INDEX "public"."IDX_0c3ff892a9f2ed16f59d31ccca"`);
    await queryRunner.query(`DROP INDEX "public"."IDX_4b81cf5bd28a3d146d7585f3a5"`);
    await queryRunner.query(`DROP TABLE "purchase_orders"`);
    await queryRunner.query(`DROP TYPE "public"."purchase_order_status"`);
  }
}
