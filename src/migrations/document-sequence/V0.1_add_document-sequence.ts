import { MigrationInterface, QueryRunner } from 'typeorm';
import { assertDestructiveDownAllowed } from '../../config/destructive-down.js';

export class AddDocumentSequence1789918197963 implements MigrationInterface {
  name = 'AddDocumentSequence1789918197963';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`CREATE TABLE "document_sequences" ("companyId" uuid NOT NULL, "series" character varying(30) NOT NULL, "lastValue" integer NOT NULL DEFAULT '0', CONSTRAINT "PK_b1d7e9ae05e1ed490ec95676865" PRIMARY KEY ("companyId", "series"))`);
    await queryRunner.query(`ALTER TABLE "document_sequences" ADD CONSTRAINT "FK_f1b9603f55edcc7592fddeef24a" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    assertDestructiveDownAllowed(this.name);
    await queryRunner.query(`ALTER TABLE "document_sequences" DROP CONSTRAINT "FK_f1b9603f55edcc7592fddeef24a"`);
    await queryRunner.query(`DROP TABLE "document_sequences"`);
  }
}
