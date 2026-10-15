import { MigrationInterface, QueryRunner } from 'typeorm';

// La categoría cuya mercancía vive en la tienda y no pasa por corredor (ver Category.directSale).
// Las categorías que ya existen siguen pasando por bodega y corredor.
export class AddCategoryDirectSale1791900000042 implements MigrationInterface {
  name = 'AddCategoryDirectSale1791900000042';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "categories" ADD "directSale" boolean NOT NULL DEFAULT false`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "categories" DROP COLUMN "directSale"`);
  }
}
