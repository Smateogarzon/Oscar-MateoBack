import { MigrationInterface, QueryRunner } from 'typeorm';

// Logo de cada empresa (`companies.logoUrl`): es lo que el menú lateral, el acceso y los recibos
// muestran de la empresa activa. Va en una migración nueva porque las anteriores ya corrieron.
//
// - Los archivos viven en la carpeta pública del front (Oscar-MateoFront/public) y se sirven desde
//   la raíz del front, por eso la ruta es relativa. Cuando las empresas suban su logo a S3 desde
//   Configuración, `logoUrl` pasa a ser una URL completa y estas rutas dejan de usarse.
// - Las filas se buscan por los ids fijos de la semilla (V0.2_seed_company).
const LOGOS: { companyId: string; logoUrl: string }[] = [
  { companyId: '10000000-0000-4000-8000-000000000001', logoUrl: '/Logo%20sin%20letras.png' },
  { companyId: '10000000-0000-4000-8000-000000000002', logoUrl: '/logo_hecho_con_amor.png' },
];

export class SeedCompanyLogos1790220768431 implements MigrationInterface {
  name = 'SeedCompanyLogos1790220768431';

  public async up(queryRunner: QueryRunner): Promise<void> {
    for (const { companyId, logoUrl } of LOGOS) {
      await queryRunner.query(
        `UPDATE "companies" SET "logoUrl" = $2, "updatedAt" = now() WHERE "id" = $1`,
        [companyId, logoUrl],
      );
    }
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    for (const { companyId, logoUrl } of LOGOS) {
      await queryRunner.query(
        `UPDATE "companies" SET "logoUrl" = NULL, "updatedAt" = now() WHERE "id" = $1 AND "logoUrl" = $2`,
        [companyId, logoUrl],
      );
    }
  }
}
