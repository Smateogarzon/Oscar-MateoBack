import { MigrationInterface, QueryRunner } from 'typeorm';

// Un permiso de ventas que faltaba: sales.view_all, ver el histórico de ventas de TODOS los
// cajeros y vendedores; sin él, cada quien ve solo las que cobró o las que vendió (ver
// SaleService.findAll). Es la contraparte de cash.view_all para el histórico de caja.
// Por defecto solo lo tienen el Administrador y el super administrador, en cada empresa que
// exista; cada empresa puede ajustarlo desde Roles y permisos. Una empresa que se cree después
// nace sin asignaciones (pendiente del futuro createCompany).
// Es una migración nueva y no una edición de V0.3_seed_sales_permissions: esa ya corrió, y una
// migración que ya corrió no se vuelve a ejecutar.
export class SeedSalesViewAllPermission1789820000000 implements MigrationInterface {
  name = 'SeedSalesViewAllPermission1789820000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      INSERT INTO "permissions" ("id", "code", "name", "module", "status")
      VALUES
        ('30000000-0000-4000-8000-000000000028', 'sales.view_all', 'Ver todo el historial de ventas', 'SALES', 'ACTIVE')
    `);

    // Repetir el reparto no duplica nada: el índice único (empresa, rol, permiso) lo ignora.
    await queryRunner.query(`
      INSERT INTO "role_permissions" ("roleId", "permissionId", "companyId")
      SELECT r."id", p."id", c."id"
      FROM "roles" r
      JOIN "permissions" p ON p."code" = 'sales.view_all'
      CROSS JOIN "companies" c
      WHERE r."code" IN ('ADMIN', 'SUPER_ADMIN')
      ON CONFLICT DO NOTHING
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      DELETE FROM "role_permissions" WHERE "permissionId" IN (
        SELECT "id" FROM "permissions" WHERE "code" = 'sales.view_all'
      )
    `);
    await queryRunner.query(`DELETE FROM "permissions" WHERE "code" = 'sales.view_all'`);
  }
}
