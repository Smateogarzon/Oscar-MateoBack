import { MigrationInterface, QueryRunner } from 'typeorm';
import { assertDestructiveDownAllowed } from '../../config/destructive-down.js';

export class AddCategory1790691651161 implements MigrationInterface {
  name = 'AddCategory1790691651161';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`CREATE TABLE "categories" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "companyId" uuid NOT NULL, "name" character varying(120) NOT NULL, "slug" character varying(140) NOT NULL, "parentId" uuid, "description" character varying(255), "status" "public"."record_status" NOT NULL DEFAULT 'ACTIVE', CONSTRAINT "PK_24dbc6126a28ff948da33e97d3b" PRIMARY KEY ("id"))`);
    await queryRunner.query(`CREATE INDEX "IDX_92d9e96e1be5a0b3e94fddb892" ON "categories"  ("companyId") `);
    await queryRunner.query(`CREATE INDEX "IDX_f88a6e7e88bfe2b5fadc9e6a2e" ON "categories"  ("companyId", "parentId") `);
    await queryRunner.query(`ALTER TABLE "categories" ADD CONSTRAINT "FK_92d9e96e1be5a0b3e94fddb892a" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`);
    await queryRunner.query(`ALTER TABLE "categories" ADD CONSTRAINT "FK_9a6f051e66982b5f0318981bcaa" FOREIGN KEY ("parentId") REFERENCES "categories"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    assertDestructiveDownAllowed(this.name);
    await queryRunner.query(`ALTER TABLE "categories" DROP CONSTRAINT "FK_9a6f051e66982b5f0318981bcaa"`);
    await queryRunner.query(`ALTER TABLE "categories" DROP CONSTRAINT "FK_92d9e96e1be5a0b3e94fddb892a"`);
    await queryRunner.query(`DROP INDEX "public"."IDX_f88a6e7e88bfe2b5fadc9e6a2e"`);
    await queryRunner.query(`DROP INDEX "public"."IDX_92d9e96e1be5a0b3e94fddb892"`);
    await queryRunner.query(`DROP TABLE "categories"`);
  }
}
