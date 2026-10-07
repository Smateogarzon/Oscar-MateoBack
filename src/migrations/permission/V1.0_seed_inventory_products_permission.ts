import { MigrationInterface, QueryRunner } from 'typeorm';
import { assertDestructiveDownAllowed } from '../../config/destructive-down.js';

// Permiso del catálogo propio de cada empresa (categorías, productos y sus variantes):
//   inventory.manage_products   crear y editar categorías, productos, colores, tallas y variantes
// Por defecto lo tienen el Administrador y el Bodeguero de cada empresa (quien recibe mercancía
// nueva la cataloga), además del super administrador. A diferencia de inventory.manage_catalog
// (V0.9), que sigue siendo solo del super administrador porque las marcas se comparten entre
// empresas, esto es propio de cada empresa: no hay el mismo riesgo de que una le cambie algo a otra.
// Una empresa que se cree después nace sin esta asignación (pendiente del futuro createCompany).
// Es una migración nueva y no una edición de las anteriores: esas ya corrieron, y una migración
// que ya corrió no se vuelve a ejecutar.
export class SeedInventoryProductsPermission1790400000001 implements MigrationInterface {
  name = 'SeedInventoryProductsPermission1790400000001';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      INSERT INTO "permissions" ("id", "code", "name", "module", "status")
      VALUES
        ('30000000-0000-4000-8000-000000000030', 'inventory.manage_products', 'Gestionar categorías, productos y variantes', 'INVENTORY', 'ACTIVE')
    `);

    // Repetir el reparto no duplica nada: el índice único (empresa, rol, permiso) lo ignora.
    await queryRunner.query(`
      INSERT INTO "role_permissions" ("roleId", "permissionId", "companyId")
      SELECT r."id", p."id", c."id"
      FROM "roles" r
      JOIN "permissions" p ON p."code" = 'inventory.manage_products'
      CROSS JOIN "companies" c
      WHERE r."code" IN ('ADMIN', 'WAREHOUSE', 'SUPER_ADMIN')
      ON CONFLICT DO NOTHING
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    assertDestructiveDownAllowed(this.name);
    await queryRunner.query(`
      DELETE FROM "role_permissions" WHERE "permissionId" IN (
        SELECT "id" FROM "permissions" WHERE "code" = 'inventory.manage_products'
      )
    `);
    await queryRunner.query(`DELETE FROM "permissions" WHERE "code" = 'inventory.manage_products'`);
  }
}
