import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddPush1791900000009 implements MigrationInterface {
  name = 'AddPush1791900000009';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`CREATE TABLE "push_subscriptions" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "userId" uuid NOT NULL, "companyId" uuid NOT NULL, "endpoint" character varying(1024) NOT NULL, "p256dh" character varying(255) NOT NULL, "auth" character varying(255) NOT NULL, "userAgent" character varying(255), "failureCount" integer NOT NULL DEFAULT '0', "lastSuccessAt" TIMESTAMP WITH TIME ZONE, "lastSeenAt" TIMESTAMP WITH TIME ZONE NOT NULL, CONSTRAINT "PK_757fc8f00c34f66832668dc2e53" PRIMARY KEY ("id"))`);
    await queryRunner.query(`CREATE INDEX "IDX_c214c75ceb2cfe2267db74e0f7" ON "push_subscriptions"  ("companyId", "userId") `);
    await queryRunner.query(`CREATE UNIQUE INDEX "IDX_3efb9d7da453567f6d508018c3" ON "push_subscriptions"  ("userId", "companyId", "endpoint") `);
    await queryRunner.query(`ALTER TABLE "push_subscriptions" ADD CONSTRAINT "FK_4cc061875e9eecc311a94b3e431" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE NO ACTION`);
    await queryRunner.query(`ALTER TABLE "push_subscriptions" ADD CONSTRAINT "FK_33c9571a3c830d56da4070177ec" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE NO ACTION`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "push_subscriptions" DROP CONSTRAINT "FK_33c9571a3c830d56da4070177ec"`);
    await queryRunner.query(`ALTER TABLE "push_subscriptions" DROP CONSTRAINT "FK_4cc061875e9eecc311a94b3e431"`);
    await queryRunner.query(`DROP INDEX "public"."IDX_3efb9d7da453567f6d508018c3"`);
    await queryRunner.query(`DROP INDEX "public"."IDX_c214c75ceb2cfe2267db74e0f7"`);
    await queryRunner.query(`DROP TABLE "push_subscriptions"`);
  }
}
