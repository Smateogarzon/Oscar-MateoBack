import { MigrationInterface, QueryRunner } from 'typeorm';

// Permisos de ejemplo, mientras se define el catálogo real por módulo.
// Timestamp +1 día: debe correr después de la migración de esquema de "permission" (V0.1),
// que todavía no existe como archivo en el momento de escribir este seed.
export class SeedPermission1789598255955 implements MigrationInterface {
  name = 'SeedPermission1789598255955';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      INSERT INTO "permissions" ("id", "code", "name", "module", "status")
      VALUES
        ('30000000-0000-0000-0000-000000000001', 'sales.create', 'Crear ventas', 'SALES', 'ACTIVE'),
        ('30000000-0000-0000-0000-000000000002', 'users.manage', 'Gestionar usuarios', 'USERS', 'ACTIVE')
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      DELETE FROM "permissions" WHERE "id" IN (
        '30000000-0000-0000-0000-000000000001',
        '30000000-0000-0000-0000-000000000002'
      )
    `);
  }
}
