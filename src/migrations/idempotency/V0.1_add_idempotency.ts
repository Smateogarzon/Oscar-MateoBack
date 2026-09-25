import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddIdempotency1790364397036 implements MigrationInterface {
  name = 'AddIdempotency1790364397036';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`CREATE TABLE "idempotency_keys" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "companyId" uuid NOT NULL, "userId" uuid NOT NULL, "operation" character varying(60) NOT NULL, "key" character varying(100) NOT NULL, "fingerprint" character varying(64) NOT NULL, "resourceType" character varying(40), "resourceId" uuid, CONSTRAINT "PK_8ad20779ad0411107a56e53d0f6" PRIMARY KEY ("id"))`);
    await queryRunner.query(`CREATE INDEX "IDX_39829cdd18d40184d32a8a4abe" ON "idempotency_keys"  ("createdAt") `);
    await queryRunner.query(`CREATE UNIQUE INDEX "IDX_1627cdea30692e6fb381417213" ON "idempotency_keys"  ("companyId", "userId", "operation", "key") `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX "public"."IDX_1627cdea30692e6fb381417213"`);
    await queryRunner.query(`DROP INDEX "public"."IDX_39829cdd18d40184d32a8a4abe"`);
    await queryRunner.query(`DROP TABLE "idempotency_keys"`);
  }
}
