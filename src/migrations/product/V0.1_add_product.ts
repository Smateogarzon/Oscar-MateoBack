import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddProduct1790691651163 implements MigrationInterface {
  name = 'AddProduct1790691651163';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`CREATE TABLE "products" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "companyId" uuid NOT NULL, "brandId" uuid, "categoryId" uuid NOT NULL, "name" character varying(180) NOT NULL, "reference" character varying(100) NOT NULL, "description" text, "status" "public"."record_status" NOT NULL DEFAULT 'ACTIVE', CONSTRAINT "PK_0806c755e0aca124e67c0cf6d7d" PRIMARY KEY ("id"))`);
    await queryRunner.query(`CREATE INDEX "IDX_47942e65af8e4235d4045515f0" ON "products"  ("companyId") `);
    await queryRunner.query(`CREATE INDEX "IDX_ea86d0c514c4ecbb5694cbf57d" ON "products"  ("brandId") `);
    await queryRunner.query(`CREATE INDEX "IDX_ff56834e735fa78a15d0cf2192" ON "products"  ("categoryId") `);
    await queryRunner.query(`CREATE UNIQUE INDEX "IDX_549c213bc44dd6248e2db87a90" ON "products"  ("companyId", "reference") `);
    await queryRunner.query(`ALTER TABLE "products" ADD CONSTRAINT "FK_47942e65af8e4235d4045515f05" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`);
    await queryRunner.query(`ALTER TABLE "products" ADD CONSTRAINT "FK_ea86d0c514c4ecbb5694cbf57df" FOREIGN KEY ("brandId") REFERENCES "brands"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`);
    await queryRunner.query(`ALTER TABLE "products" ADD CONSTRAINT "FK_ff56834e735fa78a15d0cf21926" FOREIGN KEY ("categoryId") REFERENCES "categories"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "products" DROP CONSTRAINT "FK_ff56834e735fa78a15d0cf21926"`);
    await queryRunner.query(`ALTER TABLE "products" DROP CONSTRAINT "FK_ea86d0c514c4ecbb5694cbf57df"`);
    await queryRunner.query(`ALTER TABLE "products" DROP CONSTRAINT "FK_47942e65af8e4235d4045515f05"`);
    await queryRunner.query(`DROP INDEX "public"."IDX_549c213bc44dd6248e2db87a90"`);
    await queryRunner.query(`DROP INDEX "public"."IDX_ff56834e735fa78a15d0cf2192"`);
    await queryRunner.query(`DROP INDEX "public"."IDX_ea86d0c514c4ecbb5694cbf57d"`);
    await queryRunner.query(`DROP INDEX "public"."IDX_47942e65af8e4235d4045515f0"`);
    await queryRunner.query(`DROP TABLE "products"`);
  }
}
