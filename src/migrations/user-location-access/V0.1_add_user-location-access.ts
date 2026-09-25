import { MigrationInterface, QueryRunner } from 'typeorm';
import { assertDestructiveDownAllowed } from '../../config/destructive-down.js';

export class AddUserLocationAccess1789511284024 implements MigrationInterface {
  name = 'AddUserLocationAccess1789511284024';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`CREATE TABLE "user_location_access" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "userId" uuid NOT NULL, "locationId" uuid NOT NULL, "status" "public"."record_status" NOT NULL DEFAULT 'ACTIVE', CONSTRAINT "PK_6386b96e3a0c528f40149887d80" PRIMARY KEY ("id"))`);
    await queryRunner.query(`CREATE UNIQUE INDEX "IDX_490f9e0728f2d04c433bda1c09" ON "user_location_access"  ("userId", "locationId") `);
    await queryRunner.query(`ALTER TABLE "user_location_access" ADD CONSTRAINT "FK_8e36a7a7b057134b6175ec81222" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`);
    await queryRunner.query(`ALTER TABLE "user_location_access" ADD CONSTRAINT "FK_ffaa5cb6f079b97008c89f2002d" FOREIGN KEY ("locationId") REFERENCES "locations"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    assertDestructiveDownAllowed(this.name);
    await queryRunner.query(`ALTER TABLE "user_location_access" DROP CONSTRAINT "FK_ffaa5cb6f079b97008c89f2002d"`);
    await queryRunner.query(`ALTER TABLE "user_location_access" DROP CONSTRAINT "FK_8e36a7a7b057134b6175ec81222"`);
    await queryRunner.query(`DROP INDEX "public"."IDX_490f9e0728f2d04c433bda1c09"`);
    await queryRunner.query(`DROP TABLE "user_location_access"`);
  }
}
