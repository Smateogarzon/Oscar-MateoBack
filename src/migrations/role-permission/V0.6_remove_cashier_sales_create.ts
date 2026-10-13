import { MigrationInterface, QueryRunner } from 'typeorm';

// La caja no crea ventas en blanco: cobra las órdenes que le manda el vendedor y los cambios de
// devoluciones aprobadas, y completa esas ventas (agregar, cambiar o quitar líneas, pedir descuento)
// con sus propios permisos de caja. Se le quita sales.create en todas las empresas.
export class RemoveCashierSalesCreateRolePermission1791900000012 implements MigrationInterface {
  name = 'RemoveCashierSalesCreateRolePermission1791900000012';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      DELETE FROM "role_permissions" rp
      USING "permissions" p, "roles" r
      WHERE rp."permissionId" = p."id" AND rp."roleId" = r."id"
        AND p."code" = 'sales.create' AND r."code" = 'CASHIER'
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      INSERT INTO "role_permissions" ("roleId", "permissionId", "companyId")
      SELECT r."id", p."id", c."id" FROM "roles" r
      CROSS JOIN "permissions" p
      CROSS JOIN "companies" c
      WHERE p."code" = 'sales.create' AND r."code" = 'CASHIER'
      ON CONFLICT DO NOTHING
    `);
  }
}
