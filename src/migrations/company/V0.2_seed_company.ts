import { MigrationInterface, QueryRunner } from 'typeorm';

// Compañía ficticia para poder probar el resto del sistema mientras se arma el flujo real.
// El timestamp lleva +1 día para garantizar que corra después de cualquier migración de
// esquema (role/permission) que aún no existe como archivo cuando se escribió este seed.
export class SeedCompany1789598255953 implements MigrationInterface {
  name = 'SeedCompany1789598255953';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      INSERT INTO "companies" ("id", "name", "taxId", "countryCode", "currencyCode", "timezone", "status")
      VALUES ('10000000-0000-0000-0000-000000000001', 'Ferretería Demo S.A.S.', '900000000-1', 'CO', 'COP', 'America/Bogota', 'ACTIVE')
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DELETE FROM "companies" WHERE "id" = '10000000-0000-0000-0000-000000000001'`,
    );
  }
}
