import { MigrationInterface, QueryRunner } from 'typeorm';

// Tarjeta y transferencia dejan de exigir referencia por defecto: el voucher o el número de la
// transferencia pasan a ser opcionales para cobrar, salvo que una empresa lo vuelva a exigir a
// mano desde Configuración → Medios de pago (por eso esto es una migración, no solo el cambio en
// default-payment-methods.ts: esa semilla ya corrió, y una migración que ya corrió no se vuelve a
// ejecutar, así que los medios de las empresas existentes se quedarían exigiéndola si no se
// actualizan acá).
export class OptionalReference1790020000000 implements MigrationInterface {
  name = 'OptionalReference1790020000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      UPDATE "payment_methods"
      SET "requiresReference" = false
      WHERE "type" IN ('CARD', 'TRANSFER') AND "requiresReference" = true
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      UPDATE "payment_methods"
      SET "requiresReference" = true
      WHERE "type" IN ('CARD', 'TRANSFER')
    `);
  }
}
