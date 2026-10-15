import { MigrationInterface, QueryRunner } from 'typeorm';
import { assertDestructiveDownAllowed } from '../../config/destructive-down.js';

// Permiso del catálogo de inventario (marcas y categorías; después, productos):
//   inventory.manage_catalog   crear y editar el catálogo
// Por defecto solo lo tiene el super administrador, en cada empresa que exista: las marcas son
// compartidas entre empresas (ver brand.entity.ts) y no queremos que una empresa le cambie a otra
// el nombre o el logo de una que ambas usan. Una empresa que quiera manejar sus propias categorías
// sin pasar por la plataforma puede dárselo a su Administrador desde Roles y permisos: ahí sí es
// seguro, porque las categorías son por empresa (el riesgo que asume al hacerlo es que ese mismo
// permiso también abre las marcas, que sí son compartidas).
// Una empresa que se cree después nace sin esta asignación (pendiente del futuro createCompany).
// Es una migración nueva y no una edición de las anteriores: esas ya corrieron, y una migración
// que ya corrió no se vuelve a ejecutar.
export class SeedInventoryCatalogPermission1790400000000 implements MigrationInterface {
  name = 'SeedInventoryCatalogPermission1790400000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      INSERT INTO "permissions" ("id", "code", "name", "module", "status")
      VALUES
        ('30000000-0000-4000-8000-000000000029', 'inventory.manage_catalog', 'Gestionar catálogo (marcas y categorías)', 'INVENTORY', 'ACTIVE')
    `);

    // Repetir el reparto no duplica nada: el índice único (empresa, rol, permiso) lo ignora.
    await queryRunner.query(`
      INSERT INTO "role_permissions" ("roleId", "permissionId", "companyId")
      SELECT r."id", p."id", c."id"
      FROM "roles" r
      JOIN "permissions" p ON p."code" = 'inventory.manage_catalog'
      CROSS JOIN "companies" c
      WHERE r."code" = 'SUPER_ADMIN'
      ON CONFLICT DO NOTHING
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    assertDestructiveDownAllowed(this.name);
    await queryRunner.query(`
      DELETE FROM "role_permissions" WHERE "permissionId" IN (
        SELECT "id" FROM "permissions" WHERE "code" = 'inventory.manage_catalog'
      )
    `);
    await queryRunner.query(`DELETE FROM "permissions" WHERE "code" = 'inventory.manage_catalog'`);
  }
}
