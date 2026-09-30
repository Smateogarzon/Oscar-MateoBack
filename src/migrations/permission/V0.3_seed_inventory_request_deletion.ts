import { MigrationInterface, QueryRunner } from 'typeorm';
import { assertDestructiveDownAllowed } from '../../config/destructive-down.js';

// Nuevo permiso: pedir que se borre una referencia de inventario, sin poder borrarla directo (ver
// PermissionCode.INVENTORY_REQUEST_DELETION). Corre después del seed original de permisos (V0.2).
export class SeedInventoryRequestDeletionPermission1790900000000 implements MigrationInterface {
  name = 'SeedInventoryRequestDeletionPermission1790900000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      INSERT INTO "permissions" ("id", "code", "name", "module", "status")
      VALUES ('30000000-0000-4000-8000-000000000021', 'inventory.request_deletion', 'Pedir borrar una referencia', 'INVENTORY', 'ACTIVE')
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    assertDestructiveDownAllowed(this.name);
    await queryRunner.query(`
      DELETE FROM "permissions" WHERE "id" = '30000000-0000-4000-8000-000000000021'
    `);
  }
}
