import { MigrationInterface, QueryRunner } from 'typeorm';
import { assertDestructiveDownAllowed } from '../../config/destructive-down.js';

// El inventario solo lo modifica el Administrador; el resto lo mira:
//   inventory.view   ver existencias y traslados, sin poder cambiar nada
// Lo tienen Administrador, Bodega, Vendedor y Caja (y el super administrador). Bodega pierde
// inventory.manage_products (V1.0 se lo había dado) y desaparece inventory.request_deletion: ya no
// hay solicitudes de borrado, nadie las pide ni las aprueba.
export class SeedInventoryViewPermission1791000000000 implements MigrationInterface {
  name = 'SeedInventoryViewPermission1791000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      INSERT INTO "permissions" ("id", "code", "name", "module", "status")
      VALUES ('30000000-0000-4000-8000-000000000031', 'inventory.view', 'Ver el inventario', 'INVENTORY', 'ACTIVE')
    `);

    await queryRunner.query(`
      INSERT INTO "role_permissions" ("roleId", "permissionId", "companyId")
      SELECT r."id", p."id", c."id"
      FROM "roles" r
      JOIN "permissions" p ON p."code" = 'inventory.view'
      CROSS JOIN "companies" c
      WHERE r."code" IN ('ADMIN', 'WAREHOUSE', 'SELLER', 'CASHIER', 'SUPER_ADMIN')
      ON CONFLICT DO NOTHING
    `);

    await queryRunner.query(`
      DELETE FROM "role_permissions" rp
      USING "roles" r, "permissions" p
      WHERE rp."roleId" = r."id" AND rp."permissionId" = p."id"
        AND r."code" = 'WAREHOUSE' AND p."code" = 'inventory.manage_products'
    `);

    await queryRunner.query(`
      DELETE FROM "role_permissions" WHERE "permissionId" IN (
        SELECT "id" FROM "permissions" WHERE "code" = 'inventory.request_deletion'
      )
    `);
    await queryRunner.query(`DELETE FROM "permissions" WHERE "code" = 'inventory.request_deletion'`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    assertDestructiveDownAllowed(this.name);
    await queryRunner.query(`
      INSERT INTO "permissions" ("id", "code", "name", "module", "status")
      VALUES ('30000000-0000-4000-8000-000000000032', 'inventory.request_deletion', 'Pedir borrar una referencia', 'INVENTORY', 'ACTIVE')
    `);
    await queryRunner.query(`
      INSERT INTO "role_permissions" ("roleId", "permissionId", "companyId")
      SELECT r."id", p."id", c."id"
      FROM "roles" r
      JOIN "permissions" p ON p."code" = 'inventory.manage_products'
      CROSS JOIN "companies" c
      WHERE r."code" = 'WAREHOUSE'
      ON CONFLICT DO NOTHING
    `);
    await queryRunner.query(`
      DELETE FROM "role_permissions" WHERE "permissionId" IN (
        SELECT "id" FROM "permissions" WHERE "code" = 'inventory.view'
      )
    `);
    await queryRunner.query(`DELETE FROM "permissions" WHERE "code" = 'inventory.view'`);
  }
}
