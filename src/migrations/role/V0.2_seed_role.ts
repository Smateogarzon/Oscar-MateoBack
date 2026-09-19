import { MigrationInterface, QueryRunner } from 'typeorm';

// Catálogo real de roles operativos (del diseño de la app).
// Timestamp +1 día: debe correr después de la migración de esquema de "role" (V0.1),
// que todavía no existe como archivo en el momento de escribir este seed.
export class SeedRole1789598255954 implements MigrationInterface {
  name = 'SeedRole1789598255954';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      INSERT INTO "roles" ("id", "code", "name", "description", "scope", "status")
      VALUES
        ('20000000-0000-4000-8000-000000000001', 'ADMIN', 'Administrador', 'Ve todo y autoriza bajas', 'COMPANY', 'ACTIVE'),
        ('20000000-0000-4000-8000-000000000002', 'SELLER', 'Vendedor', 'Solicita y recibe en tienda', 'COMPANY', 'ACTIVE'),
        ('20000000-0000-4000-8000-000000000003', 'WAREHOUSE', 'Bodeguero', 'Acepta, alista y despacha', 'COMPANY', 'ACTIVE'),
        ('20000000-0000-4000-8000-000000000004', 'RUNNER', 'Corredor', 'Transporta entre ubicaciones', 'COMPANY', 'ACTIVE'),
        ('20000000-0000-4000-8000-000000000005', 'CASHIER', 'Caja', 'Cobra y cierra la venta', 'COMPANY', 'ACTIVE'),
        ('20000000-0000-4000-8000-000000000006', 'SUPPLIER', 'Proveedor', 'Solo órdenes de compra', 'SUPPLIER', 'ACTIVE'),
        ('20000000-0000-4000-8000-000000000007', 'SUPER_ADMIN', 'Super administrador', 'Administra la plataforma; las empresas no lo ven', 'GLOBAL', 'ACTIVE')
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      DELETE FROM "roles" WHERE "id" IN (
        '20000000-0000-4000-8000-000000000001',
        '20000000-0000-4000-8000-000000000002',
        '20000000-0000-4000-8000-000000000003',
        '20000000-0000-4000-8000-000000000004',
        '20000000-0000-4000-8000-000000000005',
        '20000000-0000-4000-8000-000000000006',
        '20000000-0000-4000-8000-000000000007'
      )
    `);
  }
}
