import { MigrationInterface, QueryRunner } from 'typeorm';
import { assertDestructiveDownAllowed } from '../../config/destructive-down.js';

// V1.3_seed_supplier_create_references_permission le dio suppliers.create_references solo al rol
// Proveedor, a propósito (el Administrador ya cubre lo mismo con inventory.manage_products, que no
// se le da al proveedor para no abrirle movimientos de inventario directos). Pero
// UserService.create exige que quien da un rol tenga TODOS sus permisos (assertHoldsPermissions,
// "no puedes dar lo que no tienes"): como nadie le dio ese permiso también al Administrador, nadie
// podía crear un usuario Proveedor. Dárselo no le abre nada nuevo (ya tiene el permiso más amplio);
// solo corrige el vacío, igual que ya se hizo para suppliers.manage_purchase_orders (V1.6).
export class GrantAdminSupplierCreateReferences1791900000031 implements MigrationInterface {
  name = 'GrantAdminSupplierCreateReferences1791900000031';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      INSERT INTO "role_permissions" ("roleId", "permissionId", "companyId")
      SELECT r."id", p."id", c."id"
      FROM "roles" r
      JOIN "permissions" p ON p."code" = 'suppliers.create_references'
      CROSS JOIN "companies" c
      WHERE r."code" = 'ADMIN'
      ON CONFLICT DO NOTHING
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    assertDestructiveDownAllowed(this.name);
    await queryRunner.query(`
      DELETE FROM "role_permissions"
      WHERE "permissionId" IN (SELECT "id" FROM "permissions" WHERE "code" = 'suppliers.create_references')
        AND "roleId" IN (SELECT "id" FROM "roles" WHERE "code" = 'ADMIN')
    `);
  }
}
