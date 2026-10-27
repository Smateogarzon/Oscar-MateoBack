import { MigrationInterface, QueryRunner } from 'typeorm';
import { assertDestructiveDownAllowed } from '../../config/destructive-down.js';

// Cuál de las líneas de la orden llegó equivocada. Antes el retorno por error solo guardaba el
// relato de quien lo reportó: con varias referencias en una misma orden, bodega y el corredor no
// sabían cuál era la que tenía que volver. Nula en las correcciones que ya existían (nadie señaló
// una línea) y en cualquier fila que venga de ahí.
export class InternalOrderCorrectionItem1791900000020 implements MigrationInterface {
  name = 'InternalOrderCorrectionItem1791900000020';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "internal_order_corrections" ADD COLUMN "internalOrderItemId" uuid`);
    await queryRunner.query(
      `ALTER TABLE "internal_order_corrections"
         ADD CONSTRAINT "FK_internal_order_corrections_item"
         FOREIGN KEY ("internalOrderItemId") REFERENCES "internal_order_items"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    assertDestructiveDownAllowed(this.name);
    await queryRunner.query(
      `ALTER TABLE "internal_order_corrections" DROP CONSTRAINT "FK_internal_order_corrections_item"`,
    );
    await queryRunner.query(`ALTER TABLE "internal_order_corrections" DROP COLUMN "internalOrderItemId"`);
  }
}
