import { MigrationInterface, QueryRunner } from 'typeorm';

// Permisos del módulo de ventas y su reparto inicial por rol, en cada empresa que exista.
// Es una migración nueva y no una edición de V0.2_seed_permission: esa ya corrió en
// producción y una migración que ya corrió no se vuelve a ejecutar.
// Los repartos son solo el punto de partida: cada empresa los ajusta desde Roles y permisos.
// Una empresa que se cree después nace sin asignaciones (pendiente del futuro createCompany).
// Timestamp posterior a V0.3_add_company_to_role-permission, que crea role_permissions.companyId.
export class SeedSalesPermissions1789770000000 implements MigrationInterface {
  name = 'SeedSalesPermissions1789770000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      INSERT INTO "permissions" ("id", "code", "name", "module", "status")
      VALUES
        ('30000000-0000-4000-8000-000000000021', 'sales.view', 'Ver ventas', 'SALES', 'ACTIVE'),
        ('30000000-0000-4000-8000-000000000022', 'sales.cancel', 'Cancelar ventas', 'SALES', 'ACTIVE')
    `);

    // Administrador y super administrador: ven y cancelan (ya tenían sales.create).
    await this.grant(queryRunner, ['ADMIN', 'SUPER_ADMIN'], ['sales.view', 'sales.cancel']);
    // Vendedor: ya tenía sales.create; ahora también ve las ventas.
    await this.grant(queryRunner, ['SELLER'], ['sales.view']);
    // Caja: el cajero es quien da "nueva venta", así que necesita crearlas además de verlas.
    await this.grant(queryRunner, ['CASHIER'], ['sales.create', 'sales.view']);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      DELETE FROM "role_permissions" WHERE "permissionId" IN (
        SELECT "id" FROM "permissions" WHERE "code" IN ('sales.view', 'sales.cancel')
      )
    `);
    // sales.create existía antes de esta migración: solo se le quita a Caja lo que ella le dio.
    await queryRunner.query(`
      DELETE FROM "role_permissions" rp
      USING "roles" r, "permissions" p
      WHERE rp."roleId" = r."id" AND rp."permissionId" = p."id"
        AND r."code" = 'CASHIER' AND p."code" = 'sales.create'
    `);
    await queryRunner.query(`
      DELETE FROM "permissions" WHERE "code" IN ('sales.view', 'sales.cancel')
    `);
  }

  // Da a cada rol indicado los permisos indicados, en todas las empresas. Repetir el reparto
  // no duplica nada: el índice único (empresa, rol, permiso) lo ignora.
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
