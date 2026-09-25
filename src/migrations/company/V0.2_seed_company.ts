import { MigrationInterface, QueryRunner } from 'typeorm';
import { assertDestructiveDownAllowed } from '../../config/destructive-down.js';

// Compañías ficticias para poder probar el resto del sistema (incluido trabajar con varias
// empresas) mientras se arma el flujo real. Los permisos de cada rol por empresa los reparte
// V0.3_add_company_to_role-permission, que copia las asignaciones a todas las que existan.
// El timestamp lleva +1 día para garantizar que corra después de cualquier migración de
// esquema (role/permission) que aún no existe como archivo cuando se escribió este seed.
// Una semilla que ya corrió en una base no vuelve a correr: si se edita, hay que recrear la base.
export class SeedCompany1789598255953 implements MigrationInterface {
  name = 'SeedCompany1789598255953';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      INSERT INTO "companies" ("id", "name", "taxId", "countryCode", "currencyCode", "timezone", "status")
      VALUES
        ('10000000-0000-4000-8000-000000000001', 'Oscar y Mateo S.A.S.', '900000000-1', 'CO', 'COP', 'America/Bogota', 'ACTIVE'),
        ('10000000-0000-4000-8000-000000000002', 'Zapatería Demo S.A.S.', '900000001-1', 'CO', 'COP', 'America/Bogota', 'ACTIVE')
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    assertDestructiveDownAllowed(this.name);
    await queryRunner.query(`
      DELETE FROM "companies" WHERE "id" IN (
        '10000000-0000-4000-8000-000000000001',
        '10000000-0000-4000-8000-000000000002'
      )
    `);
  }
}
