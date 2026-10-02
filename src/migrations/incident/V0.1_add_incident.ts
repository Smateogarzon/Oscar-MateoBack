import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddIncident1790691651168 implements MigrationInterface {
  name = 'AddIncident1790691651168';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`CREATE TYPE "public"."incident_type" AS ENUM('INSUFFICIENT_STOCK', 'NOT_FOUND', 'DAMAGE', 'WRONG_VARIANT', 'LOSS', 'UNREGISTERED_EXIT', 'UNREGISTERED_ENTRY', 'ORDER_ISSUE', 'DELIVERY_ISSUE', 'SUPPLIER_ISSUE', 'CASH_ISSUE', 'OTHER')`);
    await queryRunner.query(`CREATE TYPE "public"."incident_status" AS ENUM('OPEN', 'IN_REVIEW', 'RESOLVED', 'CANCELLED')`);
    await queryRunner.query(`CREATE TABLE "incidents" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "companyId" uuid NOT NULL, "type" "public"."incident_type" NOT NULL, "status" "public"."incident_status" NOT NULL DEFAULT 'OPEN', "title" character varying(150) NOT NULL, "description" character varying(500), "entityType" character varying(60), "entityId" uuid, "locationId" uuid, "productVariantId" uuid, "reportedBy" uuid NOT NULL, "resolvedBy" uuid, "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "resolvedAt" TIMESTAMP WITH TIME ZONE, CONSTRAINT "PK_ccb34c01719889017e2246469f9" PRIMARY KEY ("id"))`);
    await queryRunner.query(`CREATE INDEX "IDX_574744dd392691b38d63267504" ON "incidents"  ("companyId") `);
    await queryRunner.query(`CREATE INDEX "IDX_3292bb07458fb92fb84edac36d" ON "incidents"  ("locationId") `);
    await queryRunner.query(`CREATE INDEX "IDX_b51097276a97d4d4b6b4e5e49b" ON "incidents"  ("entityType", "entityId") `);
    await queryRunner.query(`CREATE INDEX "IDX_5287eb71bad7e15868bb963661" ON "incidents"  ("companyId", "status") `);
    await queryRunner.query(`CREATE INDEX "IDX_592a1c911acb0d68bb8c9eabac" ON "incidents"  ("companyId", "type") `);
    await queryRunner.query(`ALTER TABLE "incidents" ADD CONSTRAINT "FK_574744dd392691b38d632675043" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`);
    await queryRunner.query(`ALTER TABLE "incidents" ADD CONSTRAINT "FK_3292bb07458fb92fb84edac36d8" FOREIGN KEY ("locationId") REFERENCES "locations"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`);
    await queryRunner.query(`ALTER TABLE "incidents" ADD CONSTRAINT "FK_e197cafbfbc2b1dad184ba3d9c2" FOREIGN KEY ("productVariantId") REFERENCES "product_variants"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`);
    await queryRunner.query(`ALTER TABLE "incidents" ADD CONSTRAINT "FK_8ba1754e21ee8eeeeed9c425e9f" FOREIGN KEY ("reportedBy") REFERENCES "users"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`);
    await queryRunner.query(`ALTER TABLE "incidents" ADD CONSTRAINT "FK_2e31eb74d6bc7d23732a835b46f" FOREIGN KEY ("resolvedBy") REFERENCES "users"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "incidents" DROP CONSTRAINT "FK_2e31eb74d6bc7d23732a835b46f"`);
    await queryRunner.query(`ALTER TABLE "incidents" DROP CONSTRAINT "FK_8ba1754e21ee8eeeeed9c425e9f"`);
    await queryRunner.query(`ALTER TABLE "incidents" DROP CONSTRAINT "FK_e197cafbfbc2b1dad184ba3d9c2"`);
    await queryRunner.query(`ALTER TABLE "incidents" DROP CONSTRAINT "FK_3292bb07458fb92fb84edac36d8"`);
    await queryRunner.query(`ALTER TABLE "incidents" DROP CONSTRAINT "FK_574744dd392691b38d632675043"`);
    await queryRunner.query(`DROP INDEX "public"."IDX_592a1c911acb0d68bb8c9eabac"`);
    await queryRunner.query(`DROP INDEX "public"."IDX_5287eb71bad7e15868bb963661"`);
    await queryRunner.query(`DROP INDEX "public"."IDX_b51097276a97d4d4b6b4e5e49b"`);
    await queryRunner.query(`DROP INDEX "public"."IDX_3292bb07458fb92fb84edac36d"`);
    await queryRunner.query(`DROP INDEX "public"."IDX_574744dd392691b38d63267504"`);
    await queryRunner.query(`DROP TABLE "incidents"`);
    await queryRunner.query(`DROP TYPE "public"."incident_status"`);
    await queryRunner.query(`DROP TYPE "public"."incident_type"`);
  }
}
