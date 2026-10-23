import { MigrationInterface, QueryRunner } from 'typeorm';
import { assertDestructiveDownAllowed } from '../../config/destructive-down.js';

// `categories.directSale` marcaba la mercancía que vivía en la tienda y no pasaba por corredor (la
// ropa), y con eso se decidía qué se vendía directo y qué se le podía pedir a bodega. Eso ya no lo
// decide una categoría sino la EXISTENCIA: lo que está en la tienda se cobra ahí, y lo que no, se
// pide (ver InventoryBalanceService.findStockLocationForSale e
// InternalOrderService.assertNotAlreadyInStore). La marca quedó sin leer y se va; `locations
// .directSale` —la tienda que no tiene corredores— sigue como estaba.
export class DropCategoryDirectSale1791900000051 implements MigrationInterface {
  name = 'DropCategoryDirectSale1791900000051';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "categories" DROP COLUMN "directSale"`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    assertDestructiveDownAllowed(this.name);
    // Vuelve la columna, pero no lo que estaba marcado: eso se perdió al borrarla.
    await queryRunner.query(`ALTER TABLE "categories" ADD "directSale" boolean NOT NULL DEFAULT false`);
  }
}
