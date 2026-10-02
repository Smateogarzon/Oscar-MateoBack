import { MigrationInterface, QueryRunner } from 'typeorm';

export class UpdateColor1790696671694 implements MigrationInterface {
  name = 'UpdateColor1790696671694';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "colors" ADD "secondHex" character varying(7)`);
    await queryRunner.query(`ALTER TABLE "colors" ALTER COLUMN "hex" SET NOT NULL`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "colors" ALTER COLUMN "hex" DROP NOT NULL`);
    await queryRunner.query(`ALTER TABLE "colors" DROP COLUMN "secondHex"`);
  }
}
