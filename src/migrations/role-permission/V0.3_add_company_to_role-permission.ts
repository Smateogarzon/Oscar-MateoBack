import { MigrationInterface, QueryRunner } from 'typeorm';

// Los permisos de cada rol pasan de ser globales a ser por empresa. Escrita a mano (no
// generada) porque producción ya tiene filas en role_permissions: hay que copiarlas a cada
// empresa existente antes de volver obligatoria la columna nueva.
// Timestamp +1 día sobre los seeds: debe correr después de ellos (V0.2).
export class AddCompanyToRolePermission1789684655960 implements MigrationInterface {
  name = 'AddCompanyToRolePermission1789684655960';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "role_permissions" ADD "companyId" uuid`);

    // El índice único viejo (roleId, permissionId) impediría tener la misma asignación en
    // dos empresas, ni siquiera durante la copia.
    await queryRunner.query(`DROP INDEX "public"."IDX_d430a02aad006d8a70f3acd7d0"`);

    // Cada empresa arranca con las asignaciones que hoy valen para todas.
    await queryRunner.query(`
      INSERT INTO "role_permissions" ("roleId", "permissionId", "companyId")
      SELECT rp."roleId", rp."permissionId", c."id"
      FROM "role_permissions" rp CROSS JOIN "companies" c
      WHERE rp."companyId" IS NULL
    `);
    await queryRunner.query(`DELETE FROM "role_permissions" WHERE "companyId" IS NULL`);

    await queryRunner.query(`ALTER TABLE "role_permissions" ALTER COLUMN "companyId" SET NOT NULL`);
    await queryRunner.query(`CREATE UNIQUE INDEX "IDX_role_permissions_company_role_permission" ON "role_permissions" ("companyId", "roleId", "permissionId")`);
    await queryRunner.query(`ALTER TABLE "role_permissions" ADD CONSTRAINT "FK_role_permissions_company" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`);
  }

  // Al volver a permisos globales se pierde lo que cada empresa haya personalizado: queda
  // una sola fila por (rol, permiso).
  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "role_permissions" DROP CONSTRAINT "FK_role_permissions_company"`);
    await queryRunner.query(`DROP INDEX "public"."IDX_role_permissions_company_role_permission"`);
    await queryRunner.query(`
      DELETE FROM "role_permissions" a USING "role_permissions" b
      WHERE a."roleId" = b."roleId" AND a."permissionId" = b."permissionId" AND a."id" > b."id"
    `);
    await queryRunner.query(`ALTER TABLE "role_permissions" DROP COLUMN "companyId"`);
    await queryRunner.query(`CREATE UNIQUE INDEX "IDX_d430a02aad006d8a70f3acd7d0" ON "role_permissions" ("roleId", "permissionId")`);
  }
}
