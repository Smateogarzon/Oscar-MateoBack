import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddPermission1789511284025 implements MigrationInterface {
  name = 'AddPermission1789511284025';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`CREATE TYPE "public"."permission_module" AS ENUM('SALES', 'CASH', 'INVENTORY', 'PRODUCTS', 'ORDERS', 'WAREHOUSE', 'RUNNER', 'SUPPLIERS', 'REPORTS', 'USERS', 'SETTINGS', 'KIOSK')`);
    await queryRunner.query(`CREATE TABLE "permissions" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "code" character varying(80) NOT NULL, "name" character varying(120) NOT NULL, "module" "public"."permission_module" NOT NULL, "description" character varying(255), "status" "public"."record_status" NOT NULL DEFAULT 'ACTIVE', CONSTRAINT "UQ_8dad765629e83229da6feda1c1d" UNIQUE ("code"), CONSTRAINT "PK_920331560282b8bd21bb02290df" PRIMARY KEY ("id"))`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE "permissions"`);
    await queryRunner.query(`DROP TYPE "public"."permission_module"`);
  }
}
