import { MigrationInterface, QueryRunner } from 'typeorm';
import { assertDestructiveDownAllowed } from '../../config/destructive-down.js';

// Da el permiso nuevo (inventory.request_deletion) a bodega, vendedor y caja: pueden ver el
// inventario y pedir que se borre una referencia, sin poder borrarla directo (eso lo sigue
// resolviendo quien tiene inventory.manage_products). Corre después de V0.3 de "permission".
export class SeedInventoryRequestDeletionRolePermission1790900000001 implements MigrationInterface {
  name = 'SeedInventoryRequestDeletionRolePermission1790900000001';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      INSERT INTO "role_permissions" ("roleId", "permissionId")
      SELECT r.id, p.id FROM "roles" r
      CROSS JOIN "permissions" p
      WHERE p."code" = 'inventory.request_deletion' AND r."code" IN ('WAREHOUSE', 'SELLER', 'CASHIER')
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    assertDestructiveDownAllowed(this.name);
    await queryRunner.query(`
      DELETE FROM "role_permissions" rp
      USING "permissions" p
      WHERE rp."permissionId" = p.id AND p."code" = 'inventory.request_deletion'
    `);
  }
}
