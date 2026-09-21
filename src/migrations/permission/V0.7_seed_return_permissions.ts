import { MigrationInterface, QueryRunner } from 'typeorm';

// Permisos del módulo de devoluciones y su reparto inicial, en cada empresa que exista:
//   sales.return          registrar una devolución y entregar el reembolso (Cajero, Administrador)
//   sales.approve_return  aprobar o rechazar una devolución (solo Administrador)
// Cada empresa puede ajustarlo desde Roles y permisos. Una empresa que se cree después nace sin
// asignaciones (pendiente del futuro createCompany).
// Es una migración nueva y no una edición de las anteriores: esas ya corrieron, y una migración
// que ya corrió no se vuelve a ejecutar.
export class SeedReturnPermissions1789810000000 implements MigrationInterface {
  name = 'SeedReturnPermissions1789810000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      INSERT INTO "permissions" ("id", "code", "name", "module", "status")
      VALUES
        ('30000000-0000-4000-8000-000000000026', 'sales.return', 'Registrar devoluciones', 'SALES', 'ACTIVE'),
        ('30000000-0000-4000-8000-000000000027', 'sales.approve_return', 'Aprobar devoluciones', 'SALES', 'ACTIVE')
    `);

    await this.grant(queryRunner, ['ADMIN', 'SUPER_ADMIN'], ['sales.return', 'sales.approve_return']);
    await this.grant(queryRunner, ['CASHIER'], ['sales.return']);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      DELETE FROM "role_permissions" WHERE "permissionId" IN (
        SELECT "id" FROM "permissions" WHERE "code" IN ('sales.return', 'sales.approve_return')
      )
    `);
    await queryRunner.query(`
      DELETE FROM "permissions" WHERE "code" IN ('sales.return', 'sales.approve_return')
    `);
  }

  // Da a cada rol indicado los permisos indicados, en todas las empresas. Repetir el reparto no
  // duplica nada: el índice único (empresa, rol, permiso) lo ignora.
  private async grant(
    queryRunner: QueryRunner,
    roleCodes: string[],
    permissionCodes: string[],
  ): Promise<void> {
    const roles = roleCodes.map((code) => `'${code}'`).join(', ');
    const permissions = permissionCodes.map((code) => `'${code}'`).join(', ');

    await queryRunner.query(`
      INSERT INTO "role_permissions" ("roleId", "permissionId", "companyId")
      SELECT r."id", p."id", c."id"
      FROM "roles" r
      JOIN "permissions" p ON p."code" IN (${permissions})
      CROSS JOIN "companies" c
      WHERE r."code" IN (${roles})
      ON CONFLICT DO NOTHING
    `);
  }
}
