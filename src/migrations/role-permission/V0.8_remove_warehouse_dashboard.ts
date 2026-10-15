import { MigrationInterface, QueryRunner } from 'typeorm';

// El bodeguero tampoco ve el Dashboard: V1.5 de "permission" le había dado dashboard.view al
// repartir el permiso nuevo, y V0.5 ya se lo quitó al corredor y al vendedor por lo mismo. Se le
// quita en todas las empresas; cada empresa puede volver a dárselo desde "Roles y permisos".
export class RemoveWarehouseDashboardRolePermission1791900000040 implements MigrationInterface {
  name = 'RemoveWarehouseDashboardRolePermission1791900000040';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      DELETE FROM "role_permissions" rp
      USING "permissions" p, "roles" r
      WHERE rp."permissionId" = p."id" AND rp."roleId" = r."id"
        AND p."code" = 'dashboard.view' AND r."code" = 'WAREHOUSE'
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      INSERT INTO "role_permissions" ("roleId", "permissionId", "companyId")
      SELECT r."id", p."id", c."id" FROM "roles" r
      CROSS JOIN "permissions" p
      CROSS JOIN "companies" c
      WHERE p."code" = 'dashboard.view' AND r."code" = 'WAREHOUSE'
      ON CONFLICT DO NOTHING
    `);
  }
}
