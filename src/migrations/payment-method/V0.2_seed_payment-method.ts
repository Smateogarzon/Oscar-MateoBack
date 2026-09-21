import { MigrationInterface, QueryRunner } from 'typeorm';

// Los tres medios de pago que toda empresa necesita para cobrar, en cada empresa que ya exista:
//   Efectivo (entra al cajón), Tarjeta y Transferencia (piden referencia).
// Cada empresa los puede renombrar, desactivar o ampliar con más medios. Una empresa que se cree
// después nace sin medios de pago (pendiente del futuro createCompany).
// Timestamp +1 día: debe correr después de la migración de esquema de "payment-method" (V0.1).
// Cada medio lleva un id calculado a partir de su empresa y su tipo: así el `down` borra
// exactamente los que creó este seed y nunca uno que la empresa haya creado a mano. Si la empresa
// ya tenía un medio con ese nombre, el índice único (empresa, nombre) hace que se salte.
export class SeedPaymentMethod1790011471076 implements MigrationInterface {
  name = 'SeedPaymentMethod1790011471076';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      INSERT INTO "payment_methods" ("id", "companyId", "name", "type", "requiresReference")
      SELECT md5('default-payment-method:' || c."id" || ':' || d."type")::uuid,
             c."id", d."name", d."type"::"public"."payment_method_type", d."requiresReference"
      FROM "companies" c
      CROSS JOIN (VALUES
        ('Efectivo', 'CASH', false),
        ('Tarjeta', 'CARD', true),
        ('Transferencia', 'TRANSFER', true)
      ) AS d("name", "type", "requiresReference")
      ON CONFLICT DO NOTHING
    `);
  }

  // Borra los medios que creó este seed, salvo los que ya se usaron en algún pago o reembolso:
  // esos se quedan (y se pueden desactivar), porque una venta cobrada no pierde su medio de pago.
  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      DELETE FROM "payment_methods" m
      WHERE m."id" IN (
        SELECT md5('default-payment-method:' || c."id" || ':' || d."type")::uuid
        FROM "companies" c
        CROSS JOIN (VALUES ('CASH'), ('CARD'), ('TRANSFER')) AS d("type")
      )
      AND NOT EXISTS (SELECT 1 FROM "sale_payments" p WHERE p."paymentMethodId" = m."id")
      AND NOT EXISTS (SELECT 1 FROM "refund_payments" f WHERE f."paymentMethodId" = m."id")
    `);
  }
}
