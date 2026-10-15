import { MigrationInterface, QueryRunner } from 'typeorm';

export class UpdateCommon1789929962116 implements MigrationInterface {
  name = 'UpdateCommon1789929962116';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX "public"."IDX_60e7e0e323beab94352e20b6af"`);
  }

  // Vacío a propósito: el CREATE INDEX que deshace este DROP está en el down de
  // cash-session/V0.2_update_cash-session (el generador repartía el par entre dos archivos).
  public async down(_queryRunner: QueryRunner): Promise<void> {}
}
