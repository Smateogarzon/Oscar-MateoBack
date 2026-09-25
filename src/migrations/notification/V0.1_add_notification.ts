import { MigrationInterface, QueryRunner } from 'typeorm';
import { assertDestructiveDownAllowed } from '../../config/destructive-down.js';

export class AddNotification1790220768426 implements MigrationInterface {
  name = 'AddNotification1790220768426';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`CREATE TABLE "notifications" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "companyId" uuid NOT NULL, "channel" character varying(30) NOT NULL, "type" character varying(60) NOT NULL, "title" character varying(150) NOT NULL, "message" character varying(500), "entityType" character varying(60), "entityId" uuid, "locationId" uuid, "actorId" uuid, CONSTRAINT "PK_6a72c3c0f683f6462415e653c3a" PRIMARY KEY ("id"))`);
    await queryRunner.query(`CREATE INDEX "IDX_5c2c939801558c92b39c03cdc9" ON "notifications"  ("companyId") `);
    await queryRunner.query(`CREATE INDEX "IDX_797841712968aa775af0cb0b54" ON "notifications"  ("entityType", "entityId") `);
    await queryRunner.query(`CREATE TABLE "user_notifications" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "notificationId" uuid NOT NULL, "userId" uuid NOT NULL, "readAt" TIMESTAMP WITH TIME ZONE, CONSTRAINT "PK_569622b0fd6e6ab3661de985a2b" PRIMARY KEY ("id"))`);
    await queryRunner.query(`CREATE INDEX "IDX_3271ad4145147f4efd245da879" ON "user_notifications"  ("userId", "createdAt") `);
    await queryRunner.query(`CREATE INDEX "IDX_fcf269bf4a0924571de87038bc" ON "user_notifications"  ("userId", "readAt") `);
    await queryRunner.query(`CREATE UNIQUE INDEX "IDX_1684fc4d342234900b518bcab1" ON "user_notifications"  ("notificationId", "userId") `);
    await queryRunner.query(`ALTER TABLE "notifications" ADD CONSTRAINT "FK_5c2c939801558c92b39c03cdc93" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`);
    await queryRunner.query(`ALTER TABLE "notifications" ADD CONSTRAINT "FK_c9298306148387bdeedcef73010" FOREIGN KEY ("locationId") REFERENCES "locations"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`);
    await queryRunner.query(`ALTER TABLE "notifications" ADD CONSTRAINT "FK_44412a2d6f162ff4dc1697d0db7" FOREIGN KEY ("actorId") REFERENCES "users"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`);
    await queryRunner.query(`ALTER TABLE "user_notifications" ADD CONSTRAINT "FK_01a2c65f414d36cfe6f5d950fb2" FOREIGN KEY ("notificationId") REFERENCES "notifications"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`);
    await queryRunner.query(`ALTER TABLE "user_notifications" ADD CONSTRAINT "FK_cb22b968fe41a9f8b219327fde8" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    assertDestructiveDownAllowed(this.name);
    await queryRunner.query(`ALTER TABLE "user_notifications" DROP CONSTRAINT "FK_cb22b968fe41a9f8b219327fde8"`);
    await queryRunner.query(`ALTER TABLE "user_notifications" DROP CONSTRAINT "FK_01a2c65f414d36cfe6f5d950fb2"`);
    await queryRunner.query(`ALTER TABLE "notifications" DROP CONSTRAINT "FK_44412a2d6f162ff4dc1697d0db7"`);
    await queryRunner.query(`ALTER TABLE "notifications" DROP CONSTRAINT "FK_c9298306148387bdeedcef73010"`);
    await queryRunner.query(`ALTER TABLE "notifications" DROP CONSTRAINT "FK_5c2c939801558c92b39c03cdc93"`);
    await queryRunner.query(`DROP INDEX "public"."IDX_1684fc4d342234900b518bcab1"`);
    await queryRunner.query(`DROP INDEX "public"."IDX_fcf269bf4a0924571de87038bc"`);
    await queryRunner.query(`DROP INDEX "public"."IDX_3271ad4145147f4efd245da879"`);
    await queryRunner.query(`DROP TABLE "user_notifications"`);
    await queryRunner.query(`DROP INDEX "public"."IDX_797841712968aa775af0cb0b54"`);
    await queryRunner.query(`DROP INDEX "public"."IDX_5c2c939801558c92b39c03cdc9"`);
    await queryRunner.query(`DROP TABLE "notifications"`);
  }
}
