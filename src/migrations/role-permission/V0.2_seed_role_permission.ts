import { MigrationInterface, QueryRunner } from 'typeorm';

// Asigna a cada rol sus permisos reales. Corre después de los seeds de "role" y
// "permission" (timestamps 1789598255954 y 1789598255955).
export class SeedRolePermission1789598255956 implements MigrationInterface {
  name = 'SeedRolePermission1789598255956';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // Administrador: ve todo, tiene los 20 permisos del catálogo.
    await queryRunner.query(`
      INSERT INTO "role_permissions" ("roleId", "permissionId")
      SELECT r.id, p.id FROM "roles" r CROSS JOIN "permissions" p WHERE r."code" = 'ADMIN'
    `);

    await queryRunner.query(`
      INSERT INTO "role_permissions" ("roleId", "permissionId")
      SELECT r.id, p.id FROM "roles" r
      JOIN "permissions" p ON p."code" IN (
        'sales.create', 'orders.request_from_warehouse', 'orders.confirm_receipt', 'inventory.report_returns'
      )
      WHERE r."code" = 'SELLER'
    `);

    await queryRunner.query(`
      INSERT INTO "role_permissions" ("roleId", "permissionId")
      SELECT r.id, p.id FROM "roles" r
      JOIN "permissions" p ON p."code" IN (
        'warehouse.fulfill_orders', 'warehouse.receive_returns', 'inventory.request_adjustment'
      )
      WHERE r."code" = 'WAREHOUSE'
    `);

    await queryRunner.query(`
      INSERT INTO "role_permissions" ("roleId", "permissionId")
      SELECT r.id, p.id FROM "roles" r
      JOIN "permissions" p ON p."code" IN (
        'runner.pickup_orders', 'runner.confirm_delivery', 'runner.report_incident'
      )
      WHERE r."code" = 'RUNNER'
    `);

    await queryRunner.query(`
      INSERT INTO "role_permissions" ("roleId", "permissionId")
      SELECT r.id, p.id FROM "roles" r
      JOIN "permissions" p ON p."code" IN (
        'cash.charge_orders', 'cash.register_payment', 'cash.open_close_shift'
      )
      WHERE r."code" = 'CASHIER'
    `);

    await queryRunner.query(`
      INSERT INTO "role_permissions" ("roleId", "permissionId")
      SELECT r.id, p.id FROM "roles" r
      JOIN "permissions" p ON p."code" IN (
        'suppliers.confirm_purchase_order', 'suppliers.register_delivery'
      )
      WHERE r."code" = 'SUPPLIER'
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DELETE FROM "role_permissions"`);
  }
}
