import { MigrationInterface, QueryRunner } from "typeorm";
import { assertDestructiveDownAllowed } from "../../config/destructive-down.js";

export class Temp17895091990581789509200700 implements MigrationInterface {
    name = 'Temp17895091990581789509200700'

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`CREATE TYPE "public"."company_status" AS ENUM('ACTIVE', 'INACTIVE', 'SUSPENDED')`);
        await queryRunner.query(`CREATE TABLE "companies" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "name" character varying(120) NOT NULL, "legalName" character varying(180), "taxId" character varying(30) NOT NULL, "taxIdCheckDigit" character varying(2), "address" character varying(255), "city" character varying(100), "countryCode" character varying(2) NOT NULL DEFAULT 'CO', "phone" character varying(30), "email" character varying(150), "logoUrl" text, "currencyCode" character varying(3) NOT NULL DEFAULT 'COP', "timezone" character varying(50) NOT NULL DEFAULT 'America/Bogota', "status" "public"."company_status" NOT NULL DEFAULT 'ACTIVE', CONSTRAINT "UQ_80b0c13a459e3185848ce63365f" UNIQUE ("taxId"), CONSTRAINT "PK_d4bc3e82a314fa9e29f652c2c22" PRIMARY KEY ("id"))`);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        assertDestructiveDownAllowed(this.name);
        await queryRunner.query(`DROP TABLE "companies"`);
        await queryRunner.query(`DROP TYPE "public"."company_status"`);
    }

}
