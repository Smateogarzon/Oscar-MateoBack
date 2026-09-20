import { MigrationInterface, QueryRunner } from 'typeorm';

// El turno de una caja lo abre y lo cierra el administrador, no el cajero: se le quita al rol Caja
// el permiso cash.open_close_shift en todas las empresas (cada empresa puede volver a dárselo desde
// Roles y permisos). Además se borra cash.manage_any_shift, que una versión anterior de
// V0.5_seed_cash_permissions llegó a crear y que ya no hace falta: el cajero asignado es el único
// que opera su turno, y el administrador lo abre y lo cierra.
// Es una migración nueva y no una edición de V0.2_seed_role_permission: esa ya corrió, y una
// migración que ya corrió no se vuelve a ejecutar.
export class AdjustCashShiftPermissions1789800000000 implements MigrationInterface {
  name = 'AdjustCashShiftPermissions1789800000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      DELETE FROM "role_permissions" rp
      USING "roles" r, "permissions" p
      WHERE rp."roleId" = r."id" AND rp."permissionId" = p."id"
        AND r."code" = 'CASHIER' AND p."code" = 'cash.open_close_shift'
    `);

    // Si nunca existió, no hay nada que borrar.
    await queryRunner.query(`
      DELETE FROM "role_permissions" WHERE "permissionId" IN (
        SELECT "id" FROM "permissions" WHERE "code" = 'cash.manage_any_shift'
      )
    `);
    await queryRunner.query(`DELETE FROM "permissions" WHERE "code" = 'cash.manage_any_shift'`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // Le devuelve a Caja el permiso que se le quitó, en todas las empresas.
    await queryRunner.query(`
      INSERT INTO "role_permissions" ("roleId", "permissionId", "companyId")
      SELECT r."id", p."id", c."id"
      FROM "roles" r
      JOIN "permissions" p ON p."code" = 'cash.open_close_shift'
      CROSS JOIN "companies" c
      WHERE r."code" = 'CASHIER'
      ON CONFLICT DO NOTHING
    `);
  }
}
