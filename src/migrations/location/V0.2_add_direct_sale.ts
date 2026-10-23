import { MigrationInterface, QueryRunner } from 'typeorm';

// La tienda que no tiene corredores: vende directo en caja desde su propio stock (ver
// Location.directSale). Las sedes que ya existen siguen con pedido y corredor.
export class AddLocationDirectSale1791900000041 implements MigrationInterface {
  name = 'AddLocationDirectSale1791900000041';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "locations" ADD "directSale" boolean NOT NULL DEFAULT false`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "locations" DROP COLUMN "directSale"`);
  }
}
