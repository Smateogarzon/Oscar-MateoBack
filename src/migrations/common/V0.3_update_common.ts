import { MigrationInterface, QueryRunner } from 'typeorm';

export class UpdateCommon1790220768423 implements MigrationInterface {
  name = 'UpdateCommon1790220768423';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX "public"."IDX_store_payment_methods_store_method"`);
  }

  // Vacío a propósito: el CREATE INDEX que deshace este DROP está en el down de
  // store-payment-method/V0.2_update_store-payment-method (el generador repartía el par entre dos archivos).
  public async down(_queryRunner: QueryRunner): Promise<void> {}
}
