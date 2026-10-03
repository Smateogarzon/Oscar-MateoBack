import { MigrationInterface, QueryRunner } from 'typeorm';
import { assertDestructiveDownAllowed } from '../../config/destructive-down.js';

// Dónde queda físicamente una existencia dentro de su cajón (un rack, un estante, una posición de
// bodega): "Rack A-14 · Nivel 2". Es por balanza (variante × cajón × lado), no por cajón entero,
// porque dos variantes en la misma bodega pueden estar en sitios distintos.
export class AddInventoryBalancePosition1790700000000 implements MigrationInterface {
  name = 'AddInventoryBalancePosition1790700000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "inventory_balances" ADD "position" character varying(120)`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    assertDestructiveDownAllowed(this.name);
    await queryRunner.query(`ALTER TABLE "inventory_balances" DROP COLUMN "position"`);
  }
}
