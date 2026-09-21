import { MigrationInterface, QueryRunner } from 'typeorm';

// Los medios de pago dejan de crearse a mano: toda empresa tiene los tres por defecto (ver
// default-payment-methods.ts) y cada tienda elige cuáles acepta. Esta semilla pone al día lo que ya
// existe: a cada empresa le da los medios que le falten, sin tocar los que ya tenga, y a cada tienda
// le permite todos los de su empresa (el administrador quita los que no quiera).
// Timestamp posterior al de la tabla store_payment_methods, de la que depende.
export class SeedDefaultPaymentMethods1789940000001 implements MigrationInterface {
  name = 'SeedDefaultPaymentMethods1789940000001';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // Un medio por tipo y por empresa. Si la empresa ya tiene uno de ese tipo (o uno con ese
    // nombre), se respeta el suyo.
    await queryRunner.query(`
      INSERT INTO "payment_methods" ("companyId", "name", "type", "requiresReference")
      SELECT c."id", d."name", d."type"::"public"."payment_method_type", d."requiresReference"
      FROM "companies" c
      CROSS JOIN (
        VALUES ('Efectivo', 'CASH', false), ('Tarjeta', 'CARD', true), ('Transferencia', 'TRANSFER', true)
      ) AS d("name", "type", "requiresReference")
      WHERE NOT EXISTS (
        SELECT 1 FROM "payment_methods" pm
        WHERE pm."companyId" = c."id"
          AND (pm."type" = d."type"::"public"."payment_method_type" OR pm."name" = d."name")
      )
    `);

    // Toda tienda acepta todos los medios activos de su empresa.
    await queryRunner.query(`
      INSERT INTO "store_payment_methods" ("storeId", "paymentMethodId")
      SELECT l."id", pm."id"
      FROM "locations" l
      JOIN "payment_methods" pm ON pm."companyId" = l."companyId" AND pm."status" = 'ACTIVE'
      WHERE l."type" = 'STORE'
        AND NOT EXISTS (
          SELECT 1 FROM "store_payment_methods" s
          WHERE s."storeId" = l."id" AND s."paymentMethodId" = pm."id"
        )
    `);
  }

  // Al volver atrás se quitan las relaciones tienda-medio. Los medios de pago se dejan: no se
  // puede distinguir los que puso esta semilla de los que alguien creó a mano antes.
  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DELETE FROM "store_payment_methods"`);
  }
}
