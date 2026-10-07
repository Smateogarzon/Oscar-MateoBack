import { MigrationInterface, QueryRunner } from 'typeorm';
import { assertDestructiveDownAllowed } from '../../config/destructive-down.js';

// Armar y enviar órdenes de compra deja de ser parte de inventory.manage_products y pasa a tener
// permiso propio:
//   suppliers.manage_purchase_orders   crear la orden, enviarla y cancelarla
// Lo reciben el Administrador (que ya lo hacía con inventory.manage_products) y el Proveedor, que
// ahora arma él mismo la orden de lo que va a entregar: ve la pantalla igual que el administrador.
// Se separan porque dárselo al proveedor con inventory.manage_products le habría abierto también
// los movimientos de inventario, que es justo lo que esa división evita.
// El proveedor solo puede armar órdenes a su nombre y solo ve y toca las suyas: eso no lo decide el
// permiso sino el servidor (ver purchase-order.resolver.ts).
export class SeedPurchaseOrderManagePermission1791800000000 implements MigrationInterface {
  name = 'SeedPurchaseOrderManagePermission1791800000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      INSERT INTO "permissions" ("id", "code", "name", "module", "status")
      VALUES ('30000000-0000-4000-8000-000000000038', 'suppliers.manage_purchase_orders', 'Armar y enviar órdenes de compra', 'SUPPLIERS', 'ACTIVE')
    `);

    await queryRunner.query(`
      INSERT INTO "role_permissions" ("roleId", "permissionId", "companyId")
      SELECT r."id", p."id", c."id"
      FROM "roles" r
      JOIN "permissions" p ON p."code" = 'suppliers.manage_purchase_orders'
      CROSS JOIN "companies" c
      WHERE r."code" IN ('ADMIN', 'SUPPLIER')
      ON CONFLICT DO NOTHING
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    assertDestructiveDownAllowed(this.name);
    await queryRunner.query(`
      DELETE FROM "role_permissions" WHERE "permissionId" IN (
        SELECT "id" FROM "permissions" WHERE "code" = 'suppliers.manage_purchase_orders'
      )
    `);
    await queryRunner.query(`DELETE FROM "permissions" WHERE "code" = 'suppliers.manage_purchase_orders'`);
  }
}
