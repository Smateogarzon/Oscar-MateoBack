import { MigrationInterface, QueryRunner } from 'typeorm';

// Las notas de la orden de compra no se usan: el administrador arma la orden como un carrito y la
// manda, sin indicaciones libres. `cancellationReason` es otra cosa y se queda.
export class DropPurchaseOrderNotes1791300000002 implements MigrationInterface {
  name = 'DropPurchaseOrderNotes1791300000002';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "purchase_orders" DROP COLUMN "notes"`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "purchase_orders" ADD "notes" character varying(500)`);
  }
}
