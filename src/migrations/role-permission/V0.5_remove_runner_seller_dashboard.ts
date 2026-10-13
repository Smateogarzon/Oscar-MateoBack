import { MigrationInterface, QueryRunner } from 'typeorm';

// El corredor y el vendedor no ven el Dashboard: V1.5 de "permission" les había dado dashboard.view
// al repartir el permiso nuevo. Se les quita en todas las empresas; cada empresa puede volver a
// dárselo desde "Roles y permisos" si lo quiere.
export class RemoveRunnerSellerDashboardRolePermission1791900000011 implements MigrationInterface {
  name = 'RemoveRunnerSellerDashboardRolePermission1791900000011';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      DELETE FROM "role_permissions" rp
      USING "permissions" p, "roles" r
      WHERE rp."permissionId" = p."id" AND rp."roleId" = r."id"
        AND p."code" = 'dashboard.view' AND r."code" IN ('RUNNER', 'SELLER')
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      INSERT INTO "role_permissions" ("roleId", "permissionId", "companyId")
      SELECT r."id", p."id", c."id" FROM "roles" r
      CROSS JOIN "permissions" p
      CROSS JOIN "companies" c
      WHERE p."code" = 'dashboard.view' AND r."code" IN ('RUNNER', 'SELLER')
      ON CONFLICT DO NOTHING
    `);
  }
}
