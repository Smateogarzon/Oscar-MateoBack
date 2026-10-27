import { MigrationInterface, QueryRunner } from 'typeorm';
import { assertDestructiveDownAllowed } from '../../config/destructive-down.js';

// Los mínimos de mostrador por modelo (referencia + color) y tienda: ver
// StoreModelMinimum. El índice único es el que usa el upsert (ON CONFLICT) al fijarlos desde un
// traslado o desde Inventario.
export class AddStoreModelMinimum1791900000050 implements MigrationInterface {
  name = 'AddStoreModelMinimum1791900000050';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TABLE "store_model_minimums" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "companyId" uuid NOT NULL, "locationId" uuid NOT NULL, "productId" uuid NOT NULL, "colorId" uuid NOT NULL, "minQuantity" numeric(12,2) NOT NULL, CONSTRAINT "PK_store_model_minimums" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(`CREATE INDEX "IDX_store_model_minimums_company" ON "store_model_minimums" ("companyId")`);
    await queryRunner.query(`CREATE INDEX "IDX_store_model_minimums_location" ON "store_model_minimums" ("locationId")`);
    await queryRunner.query(
      `CREATE UNIQUE INDEX "IDX_store_model_minimums_model" ON "store_model_minimums" ("companyId", "locationId", "productId", "colorId")`,
    );
    await queryRunner.query(
      `ALTER TABLE "store_model_minimums" ADD CONSTRAINT "FK_store_model_minimums_company" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "store_model_minimums" ADD CONSTRAINT "FK_store_model_minimums_location" FOREIGN KEY ("locationId") REFERENCES "locations"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "store_model_minimums" ADD CONSTRAINT "FK_store_model_minimums_product" FOREIGN KEY ("productId") REFERENCES "products"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "store_model_minimums" ADD CONSTRAINT "FK_store_model_minimums_color" FOREIGN KEY ("colorId") REFERENCES "colors"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    assertDestructiveDownAllowed(this.name);
    await queryRunner.query(`ALTER TABLE "store_model_minimums" DROP CONSTRAINT "FK_store_model_minimums_color"`);
    await queryRunner.query(`ALTER TABLE "store_model_minimums" DROP CONSTRAINT "FK_store_model_minimums_product"`);
    await queryRunner.query(`ALTER TABLE "store_model_minimums" DROP CONSTRAINT "FK_store_model_minimums_location"`);
    await queryRunner.query(`ALTER TABLE "store_model_minimums" DROP CONSTRAINT "FK_store_model_minimums_company"`);
    await queryRunner.query(`DROP INDEX "public"."IDX_store_model_minimums_model"`);
    await queryRunner.query(`DROP INDEX "public"."IDX_store_model_minimums_location"`);
    await queryRunner.query(`DROP INDEX "public"."IDX_store_model_minimums_company"`);
    await queryRunner.query(`DROP TABLE "store_model_minimums"`);
  }
}
