import { MigrationInterface, QueryRunner } from 'typeorm';
import { assertDestructiveDownAllowed } from '../../config/destructive-down.js';

interface CompanyData {
  id: string;
  name: string;
  legalName: string | null;
  taxId: string;
  address: string | null;
  city: string | null;
  phone: string | null;
  email: string | null;
}

// Datos reales de las dos empresas (según su RUT de la DIAN) en lugar de los ficticios de
// V0.2_seed_company. Va en una migración nueva porque esa semilla ya corrió en las bases
// existentes: una migración que ya corrió no se vuelve a ejecutar, y no se debe editar.
//
// - Las filas se buscan por los ids fijos de la semilla. Si falta alguna la migración aborta (y
//   TypeORM la revierte) en vez de dejar los datos ficticios sin que nadie se entere.
// - `taxId` lleva el dígito de verificación ("1005752307-1"), igual que la semilla: los tickets
//   imprimen `NIT ${taxId}` tal cual y nada lee `taxIdCheckDigit`, que se deja vacío.
// - `name` es el titular del RUT y `legalName` el nombre de la tienda. El front muestra un solo
//   nombre por empresa: `legalName` si lo tiene y, si no, `name` (`companyDisplayName` en
//   Oscar-MateoFront/src/domain/brand.ts).
// - Empresa 2: el NIT correcto es 1192758159-4 (el DV 4 solo cuadra con esos dígitos); la dirección
//   sale del RUT ("CR 1 15 96", Ibagué) y el correo va en minúsculas. Empresa 1: no se tiene la
//   ciudad, se deja vacía.
const COMPANY_1_ID = '10000000-0000-4000-8000-000000000001';
const COMPANY_2_ID = '10000000-0000-4000-8000-000000000002';

const REAL_DATA: CompanyData[] = [
  {
    id: COMPANY_1_ID,
    name: 'Óscar Adrián Montoya',
    legalName: 'La tienda de Óscar y Mateo',
    taxId: '1005752307-1',
    address: 'Cra 1 #15-05 barrio Centro',
    city: null,
    phone: '3214543565',
    email: 'oscarmontoya170696@gmail.com',
  },
  {
    id: COMPANY_2_ID,
    name: 'Yanny Shayary Santamaria Ruiz',
    legalName: 'Hecho con amor syo',
    taxId: '1192758159-4',
    address: 'Cra 1 #15-96',
    city: 'Ibagué',
    phone: '3124253718',
    email: 'santamariaruizsayary@gmail.com',
  },
];

// Lo que dejó V0.2_seed_company: solo nombre y NIT, todo lo demás vacío.
const SEED_DATA: CompanyData[] = [
  {
    id: COMPANY_1_ID,
    name: 'Oscar y Mateo S.A.S.',
    legalName: null,
    taxId: '900000000-1',
    address: null,
    city: null,
    phone: null,
    email: null,
  },
  {
    id: COMPANY_2_ID,
    name: 'Zapatería Demo S.A.S.',
    legalName: null,
    taxId: '900000001-1',
    address: null,
    city: null,
    phone: null,
    email: null,
  },
];

async function applyCompanyData(queryRunner: QueryRunner, companies: CompanyData[]): Promise<void> {
  const existing: unknown[] = await queryRunner.query(
    `SELECT "id" FROM "companies" WHERE "id" = ANY($1::uuid[])`,
    [companies.map((company) => company.id)],
  );
  if (existing.length !== companies.length) {
    throw new Error(
      `Faltan empresas de la semilla (se esperaban ${companies.length}, hay ${existing.length}): no se actualiza nada`,
    );
  }

  for (const company of companies) {
    await queryRunner.query(
      `
        UPDATE "companies"
        SET "name" = $2,
            "legalName" = $3,
            "taxId" = $4,
            "address" = $5,
            "city" = $6,
            "phone" = $7,
            "email" = $8,
            "updatedAt" = now()
        WHERE "id" = $1
      `,
      [
        company.id,
        company.name,
        company.legalName,
        company.taxId,
        company.address,
        company.city,
        company.phone,
        company.email,
      ],
    );
  }
}

export class UpdateCompanyRealData1790220768430 implements MigrationInterface {
  name = 'UpdateCompanyRealData1790220768430';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await applyCompanyData(queryRunner, REAL_DATA);
  }

  // Vuelve a los datos ficticios de la semilla: pisa nombre, NIT y contacto reales de las empresas.
  public async down(queryRunner: QueryRunner): Promise<void> {
    assertDestructiveDownAllowed(this.name);
    await applyCompanyData(queryRunner, SEED_DATA);
  }
}
