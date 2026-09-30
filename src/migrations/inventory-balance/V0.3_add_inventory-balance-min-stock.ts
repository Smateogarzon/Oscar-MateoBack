import { MigrationInterface, QueryRunner } from 'typeorm';

// Debajo de esta cantidad la existencia de la balanza se considera baja (para alertas de
// agotamiento, aún por construir). Por balanza (variante × cajón × lado), igual que position: null
// si nadie fijó un mínimo.
export class AddInventoryBalanceMinStock1790800000000 implements MigrationInterface {
  name = 'AddInventoryBalanceMinStock1790800000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "inventory_balances" ADD "minStock" numeric(12,2)`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "inventory_balances" DROP COLUMN "minStock"`);
  }
}
