import { MigrationInterface, QueryRunner } from 'typeorm';
import { assertDestructiveDownAllowed } from '../../config/destructive-down.js';

export class AddInventoryLocation1790691651169 implements MigrationInterface {
  name = 'AddInventoryLocation1790691651169';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`CREATE TYPE "public"."inventory_location_type" AS ENUM('STOCK', 'DISPLAY', 'RUNNER', 'TRANSIT', 'DAMAGED', 'RETURNS')`);
    await queryRunner.query(`CREATE TABLE "inventory_locations" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "companyId" uuid NOT NULL, "locationId" uuid, "type" "public"."inventory_location_type" NOT NULL, "custodianUserId" uuid, "status" "public"."record_status" NOT NULL DEFAULT 'ACTIVE', CONSTRAINT "PK_b9591ced2c9d787495d19639575" PRIMARY KEY ("id"))`);
    await queryRunner.query(`CREATE INDEX "IDX_4859fa89c0f2fcae7ce40295cd" ON "inventory_locations"  ("companyId") `);
    await queryRunner.query(`CREATE INDEX "IDX_419917dc90c0a1fb4305a8080f" ON "inventory_locations"  ("locationId") `);
    await queryRunner.query(`CREATE INDEX "IDX_139b2634d14a75b20a837a880a" ON "inventory_locations"  ("companyId", "type") `);
    await queryRunner.query(`ALTER TABLE "inventory_locations" ADD CONSTRAINT "FK_4859fa89c0f2fcae7ce40295cda" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`);
    await queryRunner.query(`ALTER TABLE "inventory_locations" ADD CONSTRAINT "FK_419917dc90c0a1fb4305a8080ff" FOREIGN KEY ("locationId") REFERENCES "locations"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`);
    await queryRunner.query(`ALTER TABLE "inventory_locations" ADD CONSTRAINT "FK_235b3a78cc241ffe9e17c5e3e36" FOREIGN KEY ("custodianUserId") REFERENCES "users"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    assertDestructiveDownAllowed(this.name);
    await queryRunner.query(`ALTER TABLE "inventory_locations" DROP CONSTRAINT "FK_235b3a78cc241ffe9e17c5e3e36"`);
    await queryRunner.query(`ALTER TABLE "inventory_locations" DROP CONSTRAINT "FK_419917dc90c0a1fb4305a8080ff"`);
    await queryRunner.query(`ALTER TABLE "inventory_locations" DROP CONSTRAINT "FK_4859fa89c0f2fcae7ce40295cda"`);
    await queryRunner.query(`DROP INDEX "public"."IDX_139b2634d14a75b20a837a880a"`);
    await queryRunner.query(`DROP INDEX "public"."IDX_419917dc90c0a1fb4305a8080f"`);
    await queryRunner.query(`DROP INDEX "public"."IDX_4859fa89c0f2fcae7ce40295cd"`);
    await queryRunner.query(`DROP TABLE "inventory_locations"`);
    await queryRunner.query(`DROP TYPE "public"."inventory_location_type"`);
  }
}
