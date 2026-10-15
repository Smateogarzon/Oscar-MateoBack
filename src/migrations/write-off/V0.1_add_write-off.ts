import { MigrationInterface, QueryRunner } from 'typeorm';
import { assertDestructiveDownAllowed } from '../../config/destructive-down.js';

export class AddWriteOff1790902399420 implements MigrationInterface {
  name = 'AddWriteOff1790902399420';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`CREATE TYPE "public"."write_off_status" AS ENUM('PENDING', 'APPROVED', 'REJECTED', 'CANCELLED')`);
    await queryRunner.query(`CREATE TABLE "write_offs" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "companyId" uuid NOT NULL, "locationId" uuid NOT NULL, "writeOffNumber" character varying(50) NOT NULL, "status" "public"."write_off_status" NOT NULL DEFAULT 'PENDING', "reason" character varying(255), "notes" character varying(500), "requestedBy" uuid NOT NULL, "resolvedBy" uuid, "requestedAt" TIMESTAMP WITH TIME ZONE NOT NULL, "resolvedAt" TIMESTAMP WITH TIME ZONE, CONSTRAINT "PK_5ea700b624a2713f69dcf5998ae" PRIMARY KEY ("id"))`);
    await queryRunner.query(`CREATE INDEX "IDX_bbc1878d46f0306d8b13c89923" ON "write_offs"  ("companyId") `);
    await queryRunner.query(`CREATE INDEX "IDX_7ff2cbd1da2e6ade63e57c7fe6" ON "write_offs"  ("locationId") `);
    await queryRunner.query(`CREATE INDEX "IDX_a58cee388c24dd317fc908dbc7" ON "write_offs"  ("companyId", "status") `);
    await queryRunner.query(`CREATE UNIQUE INDEX "IDX_97c2a471d1a4a1d30c65c05d54" ON "write_offs"  ("companyId", "writeOffNumber") `);
    await queryRunner.query(`CREATE TABLE "write_off_items" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "writeOffId" uuid NOT NULL, "productVariantId" uuid NOT NULL, "quantity" numeric(12,2) NOT NULL, "incidentId" uuid, "notes" character varying(255), CONSTRAINT "PK_eb5cdfcce0113f8a2160e620a74" PRIMARY KEY ("id"))`);
    await queryRunner.query(`CREATE INDEX "IDX_e9d4931e3da2e56d3ac7bccf5e" ON "write_off_items"  ("productVariantId") `);
    await queryRunner.query(`CREATE INDEX "IDX_ceb1708a83be6919247a0cadb9" ON "write_off_items"  ("writeOffId") `);
    await queryRunner.query(`ALTER TABLE "write_offs" ADD CONSTRAINT "FK_bbc1878d46f0306d8b13c89923d" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`);
    await queryRunner.query(`ALTER TABLE "write_offs" ADD CONSTRAINT "FK_7ff2cbd1da2e6ade63e57c7fe6f" FOREIGN KEY ("locationId") REFERENCES "locations"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`);
    await queryRunner.query(`ALTER TABLE "write_offs" ADD CONSTRAINT "FK_1f5e770dbac6c3de0a9e28f7558" FOREIGN KEY ("requestedBy") REFERENCES "users"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`);
    await queryRunner.query(`ALTER TABLE "write_offs" ADD CONSTRAINT "FK_077114a2b01fc4676dbfdca2e1a" FOREIGN KEY ("resolvedBy") REFERENCES "users"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`);
    await queryRunner.query(`ALTER TABLE "write_off_items" ADD CONSTRAINT "FK_ceb1708a83be6919247a0cadb9d" FOREIGN KEY ("writeOffId") REFERENCES "write_offs"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`);
    await queryRunner.query(`ALTER TABLE "write_off_items" ADD CONSTRAINT "FK_e9d4931e3da2e56d3ac7bccf5e9" FOREIGN KEY ("productVariantId") REFERENCES "product_variants"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`);
    await queryRunner.query(`ALTER TABLE "write_off_items" ADD CONSTRAINT "FK_743bf81c02d67ca9ca83bd3d1d8" FOREIGN KEY ("incidentId") REFERENCES "incidents"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    assertDestructiveDownAllowed(this.name);
    await queryRunner.query(`ALTER TABLE "write_off_items" DROP CONSTRAINT "FK_743bf81c02d67ca9ca83bd3d1d8"`);
    await queryRunner.query(`ALTER TABLE "write_off_items" DROP CONSTRAINT "FK_e9d4931e3da2e56d3ac7bccf5e9"`);
    await queryRunner.query(`ALTER TABLE "write_off_items" DROP CONSTRAINT "FK_ceb1708a83be6919247a0cadb9d"`);
    await queryRunner.query(`ALTER TABLE "write_offs" DROP CONSTRAINT "FK_077114a2b01fc4676dbfdca2e1a"`);
    await queryRunner.query(`ALTER TABLE "write_offs" DROP CONSTRAINT "FK_1f5e770dbac6c3de0a9e28f7558"`);
    await queryRunner.query(`ALTER TABLE "write_offs" DROP CONSTRAINT "FK_7ff2cbd1da2e6ade63e57c7fe6f"`);
    await queryRunner.query(`ALTER TABLE "write_offs" DROP CONSTRAINT "FK_bbc1878d46f0306d8b13c89923d"`);
    await queryRunner.query(`DROP INDEX "public"."IDX_ceb1708a83be6919247a0cadb9"`);
    await queryRunner.query(`DROP INDEX "public"."IDX_e9d4931e3da2e56d3ac7bccf5e"`);
    await queryRunner.query(`DROP TABLE "write_off_items"`);
    await queryRunner.query(`DROP INDEX "public"."IDX_97c2a471d1a4a1d30c65c05d54"`);
    await queryRunner.query(`DROP INDEX "public"."IDX_a58cee388c24dd317fc908dbc7"`);
    await queryRunner.query(`DROP INDEX "public"."IDX_7ff2cbd1da2e6ade63e57c7fe6"`);
    await queryRunner.query(`DROP INDEX "public"."IDX_bbc1878d46f0306d8b13c89923"`);
    await queryRunner.query(`DROP TABLE "write_offs"`);
    await queryRunner.query(`DROP TYPE "public"."write_off_status"`);
  }
}
