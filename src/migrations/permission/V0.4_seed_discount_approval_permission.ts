import { MigrationInterface, QueryRunner } from 'typeorm';

// Permiso para aprobar o rechazar las solicitudes de descuento de una venta. Por defecto solo
// lo tienen el Administrador y el super administrador, en cada empresa que exista; cada empresa
// puede ajustarlo desde Roles y permisos. Una empresa que se cree después nace sin
// asignaciones (pendiente del futuro createCompany).
// Es una migración nueva y no una edición de V0.3_seed_sales_permissions: esa puede haber
// corrido ya, y una migración que ya corrió no se vuelve a ejecutar.
export class SeedDiscountApprovalPermission1789780000000 implements MigrationInterface {
  name = 'SeedDiscountApprovalPermission1789780000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      INSERT INTO "permissions" ("id", "code", "name", "module", "status")
      VALUES
        ('30000000-0000-4000-8000-000000000023', 'sales.approve_discount', 'Aprobar descuentos', 'SALES', 'ACTIVE')
    `);

    // Repetir el reparto no duplica nada: el índice único (empresa, rol, permiso) lo ignora.
    await queryRunner.query(`
      INSERT INTO "role_permissions" ("roleId", "permissionId", "companyId")
      SELECT r."id", p."id", c."id"
      FROM "roles" r
      JOIN "permissions" p ON p."code" = 'sales.approve_discount'
      CROSS JOIN "companies" c
      WHERE r."code" IN ('ADMIN', 'SUPER_ADMIN')
      ON CONFLICT DO NOTHING
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      DELETE FROM "role_permissions" WHERE "permissionId" IN (
        SELECT "id" FROM "permissions" WHERE "code" = 'sales.approve_discount'
      )
    `);
    await queryRunner.query(`DELETE FROM "permissions" WHERE "code" = 'sales.approve_discount'`);
  }
}
