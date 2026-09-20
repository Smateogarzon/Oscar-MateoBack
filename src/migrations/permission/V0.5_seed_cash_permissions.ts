import { MigrationInterface, QueryRunner } from 'typeorm';

// Un permiso de caja que faltaba: cash.view_all, ver el historial de TODOS los turnos y movimientos
// de caja; sin él, cada cajero ve solo los turnos que se le asignaron.
// Por defecto solo lo tienen el Administrador y el super administrador, en cada empresa que exista;
// cada empresa puede ajustarlo desde Roles y permisos. Una empresa que se cree después nace sin
// asignaciones (pendiente del futuro createCompany).
// Es una migración nueva y no una edición de V0.2_seed_permission: esa ya corrió, y una migración
// que ya corrió no se vuelve a ejecutar.
export class SeedCashPermissions1789790000000 implements MigrationInterface {
  name = 'SeedCashPermissions1789790000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      INSERT INTO "permissions" ("id", "code", "name", "module", "status")
      VALUES
        ('30000000-0000-4000-8000-000000000024', 'cash.view_all', 'Ver todo el historial de caja', 'CASH', 'ACTIVE')
    `);

    // Repetir el reparto no duplica nada: el índice único (empresa, rol, permiso) lo ignora.
    await queryRunner.query(`
      INSERT INTO "role_permissions" ("roleId", "permissionId", "companyId")
      SELECT r."id", p."id", c."id"
      FROM "roles" r
      JOIN "permissions" p ON p."code" = 'cash.view_all'
      CROSS JOIN "companies" c
      WHERE r."code" IN ('ADMIN', 'SUPER_ADMIN')
      ON CONFLICT DO NOTHING
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      DELETE FROM "role_permissions" WHERE "permissionId" IN (
        SELECT "id" FROM "permissions" WHERE "code" = 'cash.view_all'
      )
    `);
    await queryRunner.query(`DELETE FROM "permissions" WHERE "code" = 'cash.view_all'`);
  }
}
