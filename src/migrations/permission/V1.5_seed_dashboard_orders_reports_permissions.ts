import { MigrationInterface, QueryRunner } from 'typeorm';
import { assertDestructiveDownAllowed } from '../../config/destructive-down.js';

// Dashboard, Pedidos y Reportes eran las únicas secciones del menú sin permiso propio: se mostraban
// a todo el mundo menos al cajero y no había forma de darlas o quitarlas por rol en "Roles y
// permisos". Cada una entra al catálogo con su permiso de ver:
//   dashboard.view   el tablero de la empresa (módulo DASHBOARD, nuevo)
//   orders.view      la sección Pedidos; ver TODOS los pedidos de la empresa sigue siendo
//                    orders.view_all, igual que sales.view frente a sales.view_all
//   reports.view     los reportes
export class SeedDashboardOrdersReportsPermissions1791700000000 implements MigrationInterface {
  name = 'SeedDashboardOrdersReportsPermissions1791700000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // El módulo DASHBOARD no existía en el enum. Se recrea el tipo (en vez de ALTER TYPE ... ADD
    // VALUE) porque el valor nuevo se usa en el INSERT de esta misma transacción, y Postgres no
    // permite usar un valor de enum recién agregado antes de que la transacción termine.
    await queryRunner.query(`ALTER TYPE "public"."permission_module" RENAME TO "permission_module_old"`);
    await queryRunner.query(`CREATE TYPE "public"."permission_module" AS ENUM('DASHBOARD', 'SALES', 'CASH', 'INVENTORY', 'PRODUCTS', 'ORDERS', 'WAREHOUSE', 'RUNNER', 'SUPPLIERS', 'REPORTS', 'USERS', 'SETTINGS', 'KIOSK')`);
    await queryRunner.query(`ALTER TABLE "permissions" ALTER COLUMN "module" TYPE "public"."permission_module" USING "module"::"text"::"public"."permission_module"`);
    await queryRunner.query(`DROP TYPE "public"."permission_module_old"`);

    await queryRunner.query(`
      INSERT INTO "permissions" ("id", "code", "name", "module", "status")
      VALUES
        ('30000000-0000-4000-8000-000000000035', 'dashboard.view', 'Ver el dashboard', 'DASHBOARD', 'ACTIVE'),
        ('30000000-0000-4000-8000-000000000036', 'orders.view', 'Ver pedidos', 'ORDERS', 'ACTIVE'),
        ('30000000-0000-4000-8000-000000000037', 'reports.view', 'Ver reportes', 'REPORTS', 'ACTIVE')
    `);

    // Reparto inicial, en cada empresa: Dashboard y Pedidos para quien ya ve esas secciones y
    // trabaja los pedidos internos (el cajero no las ve, y el proveedor solo atiende sus órdenes de
    // compra). Reportes nace solo para la administración; de ahí en adelante cada empresa lo reparte
    // desde la pantalla.
    await queryRunner.query(`
      INSERT INTO "role_permissions" ("roleId", "permissionId", "companyId")
      SELECT r."id", p."id", c."id"
      FROM (VALUES
        ('dashboard.view', 'ADMIN'),
        ('dashboard.view', 'SUPER_ADMIN'),
        ('dashboard.view', 'SELLER'),
        ('dashboard.view', 'WAREHOUSE'),
        ('dashboard.view', 'RUNNER'),
        ('orders.view', 'ADMIN'),
        ('orders.view', 'SUPER_ADMIN'),
        ('orders.view', 'SELLER'),
        ('orders.view', 'WAREHOUSE'),
        ('orders.view', 'RUNNER'),
        ('reports.view', 'ADMIN'),
        ('reports.view', 'SUPER_ADMIN')
      ) AS grants("permissionCode", "roleCode")
      JOIN "permissions" p ON p."code" = grants."permissionCode"
      JOIN "roles" r ON r."code" = grants."roleCode"
      CROSS JOIN "companies" c
      ON CONFLICT DO NOTHING
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    assertDestructiveDownAllowed(this.name);
    await queryRunner.query(`
      DELETE FROM "role_permissions" rp
      USING "permissions" p
      WHERE rp."permissionId" = p."id"
        AND p."code" IN ('dashboard.view', 'orders.view', 'reports.view')
    `);
    await queryRunner.query(`
      DELETE FROM "permissions" WHERE "code" IN ('dashboard.view', 'orders.view', 'reports.view')
    `);

    // Sin dashboard.view ya no queda ningún permiso en el módulo DASHBOARD: el enum vuelve a como estaba.
    await queryRunner.query(`ALTER TYPE "public"."permission_module" RENAME TO "permission_module_old"`);
    await queryRunner.query(`CREATE TYPE "public"."permission_module" AS ENUM('SALES', 'CASH', 'INVENTORY', 'PRODUCTS', 'ORDERS', 'WAREHOUSE', 'RUNNER', 'SUPPLIERS', 'REPORTS', 'USERS', 'SETTINGS', 'KIOSK')`);
    await queryRunner.query(`ALTER TABLE "permissions" ALTER COLUMN "module" TYPE "public"."permission_module" USING "module"::"text"::"public"."permission_module"`);
    await queryRunner.query(`DROP TYPE "public"."permission_module_old"`);
  }
}
