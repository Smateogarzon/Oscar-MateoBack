import { MigrationInterface, QueryRunner } from 'typeorm';

// La venta que abre la caja sin sales.create: solo acepta líneas no inventariadas (ver
// Sale.genericOnly y SaleService.addItem). Las ventas que ya existen no lo son.
export class UpdateSale1791900000043 implements MigrationInterface {
  name = 'UpdateSale1791900000043';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "sales" ADD "genericOnly" boolean NOT NULL DEFAULT false`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "sales" DROP COLUMN "genericOnly"`);
  }
}
