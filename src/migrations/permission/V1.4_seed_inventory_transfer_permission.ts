import { MigrationInterface, QueryRunner } from 'typeorm';
import { assertDestructiveDownAllowed } from '../../config/destructive-down.js';

// Permiso propio del módulo de Transferencias:
//   inventory.transfer   ver los traslados entre tiendas y bodegas y registrarlos
// Hasta ahora el módulo no tenía permiso propio: lo veía cualquiera con inventory.view (Bodega,
// Vendedor, Caja) y lo registraba quien tuviera inventory.manage_products. Ahora es un permiso
// solo: quién lo tenga ve el módulo y hace traslados, y a quién se le quite deja de ver hasta el
// historial. Por defecto se lo damos al Administrador y al super administrador — los únicos que
// hoy podían registrar un traslado; a Bodega, Vendedor o Caja se les concede desde
// Configuración → Roles y permisos cuando la empresa lo decida.
export class SeedInventoryTransferPermission1791600000000 implements MigrationInterface {
  name = 'SeedInventoryTransferPermission1791600000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      INSERT INTO "permissions" ("id", "code", "name", "module", "status")
      VALUES ('30000000-0000-4000-8000-000000000034', 'inventory.transfer', 'Ver y hacer transferencias', 'INVENTORY', 'ACTIVE')
    `);

    await queryRunner.query(`
      INSERT INTO "role_permissions" ("roleId", "permissionId", "companyId")
      SELECT r."id", p."id", c."id"
      FROM "roles" r
      JOIN "permissions" p ON p."code" = 'inventory.transfer'
      CROSS JOIN "companies" c
      WHERE r."code" IN ('ADMIN', 'SUPER_ADMIN')
      ON CONFLICT DO NOTHING
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    assertDestructiveDownAllowed(this.name);
    await queryRunner.query(`
      DELETE FROM "role_permissions" WHERE "permissionId" IN (
        SELECT "id" FROM "permissions" WHERE "code" = 'inventory.transfer'
      )
    `);
    await queryRunner.query(`DELETE FROM "permissions" WHERE "code" = 'inventory.transfer'`);
  }
}
