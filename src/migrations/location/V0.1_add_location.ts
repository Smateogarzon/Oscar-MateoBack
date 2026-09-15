import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddLocation1789511284023 implements MigrationInterface {
  name = 'AddLocation1789511284023';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`CREATE TYPE "public"."location_type" AS ENUM('STORE', 'WAREHOUSE')`);
    await queryRunner.query(`CREATE TABLE "locations" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "companyId" uuid NOT NULL, "name" character varying(120) NOT NULL, "type" "public"."location_type" NOT NULL, "address" character varying(255), "city" character varying(100), "phone" character varying(30), "email" character varying(150), "status" "public"."record_status" NOT NULL DEFAULT 'ACTIVE', CONSTRAINT "PK_7cc1c9e3853b94816c094825e74" PRIMARY KEY ("id"))`);
    await queryRunner.query(`CREATE INDEX "IDX_aa1663e9ee4cefa986683fde5b" ON "locations"  ("companyId") `);
    await queryRunner.query(`CREATE INDEX "IDX_cc005283f64222667123342ac3" ON "locations"  ("companyId", "type") `);
    await queryRunner.query(`ALTER TABLE "locations" ADD CONSTRAINT "FK_aa1663e9ee4cefa986683fde5b7" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "locations" DROP CONSTRAINT "FK_aa1663e9ee4cefa986683fde5b7"`);
    await queryRunner.query(`DROP INDEX "public"."IDX_cc005283f64222667123342ac3"`);
    await queryRunner.query(`DROP INDEX "public"."IDX_aa1663e9ee4cefa986683fde5b"`);
    await queryRunner.query(`DROP TABLE "locations"`);
    await queryRunner.query(`DROP TYPE "public"."location_type"`);
  }
}
