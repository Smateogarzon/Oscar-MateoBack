import { MigrationInterface, QueryRunner } from 'typeorm';
import { assertDestructiveDownAllowed } from '../../config/destructive-down.js';

// Permiso propio del proveedor:
//   suppliers.create_references   crear productos y variantes (referencias nuevas)
// Se lo dan solo al rol Proveedor de cada empresa: el Administrador ya puede crear referencias con
// inventory.manage_products, que NO se le da al proveedor porque también habilita movimientos de
// inventario directos (saltándose la orden de compra que él mismo debe aceptar).
export class SeedSupplierCreateReferencesPermission1791300000000 implements MigrationInterface {
  name = 'SeedSupplierCreateReferencesPermission1791300000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      INSERT INTO "permissions" ("id", "code", "name", "module", "status")
      VALUES ('30000000-0000-4000-8000-000000000033', 'suppliers.create_references', 'Crear referencias (productos y variantes)', 'SUPPLIERS', 'ACTIVE')
    `);

    await queryRunner.query(`
      INSERT INTO "role_permissions" ("roleId", "permissionId", "companyId")
      SELECT r."id", p."id", c."id"
      FROM "roles" r
      JOIN "permissions" p ON p."code" = 'suppliers.create_references'
      CROSS JOIN "companies" c
      WHERE r."code" = 'SUPPLIER'
      ON CONFLICT DO NOTHING
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    assertDestructiveDownAllowed(this.name);
    await queryRunner.query(`
      DELETE FROM "role_permissions" WHERE "permissionId" IN (
        SELECT "id" FROM "permissions" WHERE "code" = 'suppliers.create_references'
      )
    `);
    await queryRunner.query(`DELETE FROM "permissions" WHERE "code" = 'suppliers.create_references'`);
  }
}
