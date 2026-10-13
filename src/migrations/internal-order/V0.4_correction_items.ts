import { MigrationInterface, QueryRunner } from 'typeorm';
import { assertDestructiveDownAllowed } from '../../config/destructive-down.js';

// Un retorno por error puede cubrir varias líneas: el alistamiento falla en más de una referencia de
// la misma orden y el corredor las devuelve todas en el mismo viaje. La línea señalada deja de ser
// una columna de la corrección (V0.3) y pasa a su propia tabla; lo que ya se hubiera señalado se
// mueve tal cual, una fila por corrección.
export class InternalOrderCorrectionItems1791900000021 implements MigrationInterface {
  name = 'InternalOrderCorrectionItems1791900000021';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`CREATE TABLE "internal_order_correction_items" (
      "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
      "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
      "correctionId" uuid NOT NULL,
      "internalOrderItemId" uuid NOT NULL,
      CONSTRAINT "PK_internal_order_correction_items" PRIMARY KEY ("id")
    )`);
    await queryRunner.query(
      `CREATE UNIQUE INDEX "IDX_internal_order_correction_items_pair" ON "internal_order_correction_items" ("correctionId", "internalOrderItemId")`,
    );
    await queryRunner.query(
      `ALTER TABLE "internal_order_correction_items"
         ADD CONSTRAINT "FK_internal_order_correction_items_correction"
         FOREIGN KEY ("correctionId") REFERENCES "internal_order_corrections"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "internal_order_correction_items"
         ADD CONSTRAINT "FK_internal_order_correction_items_item"
         FOREIGN KEY ("internalOrderItemId") REFERENCES "internal_order_items"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`,
    );

    await queryRunner.query(
      `INSERT INTO "internal_order_correction_items" ("correctionId", "internalOrderItemId")
         SELECT "id", "internalOrderItemId" FROM "internal_order_corrections" WHERE "internalOrderItemId" IS NOT NULL`,
    );
    await queryRunner.query(
      `ALTER TABLE "internal_order_corrections" DROP CONSTRAINT "FK_internal_order_corrections_item"`,
    );
    await queryRunner.query(`ALTER TABLE "internal_order_corrections" DROP COLUMN "internalOrderItemId"`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    assertDestructiveDownAllowed(this.name);
    // La columna solo guarda una línea: de las correcciones con varias se conserva la primera.
    await queryRunner.query(`ALTER TABLE "internal_order_corrections" ADD COLUMN "internalOrderItemId" uuid`);
    await queryRunner.query(
      `ALTER TABLE "internal_order_corrections"
         ADD CONSTRAINT "FK_internal_order_corrections_item"
         FOREIGN KEY ("internalOrderItemId") REFERENCES "internal_order_items"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `UPDATE "internal_order_corrections" SET "internalOrderItemId" = (
         SELECT "internalOrderItemId" FROM "internal_order_correction_items"
          WHERE "correctionId" = "internal_order_corrections"."id"
          ORDER BY "createdAt" ASC LIMIT 1
       )`,
    );
    await queryRunner.query(`DROP TABLE "internal_order_correction_items"`);
  }
}
