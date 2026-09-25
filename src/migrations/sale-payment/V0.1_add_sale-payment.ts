import { MigrationInterface, QueryRunner } from 'typeorm';
import { assertDestructiveDownAllowed } from '../../config/destructive-down.js';

export class AddSalePayment1789925071080 implements MigrationInterface {
  name = 'AddSalePayment1789925071080';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`CREATE TABLE "sale_payments" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "saleId" uuid NOT NULL, "paymentMethodId" uuid NOT NULL, "amount" numeric(14,2) NOT NULL, "reference" character varying(120), "receivedBy" uuid NOT NULL, CONSTRAINT "PK_1117d02608a00d131b95f60a58e" PRIMARY KEY ("id"))`);
    await queryRunner.query(`CREATE INDEX "IDX_ad8e4736c560dc015611d3b7fc" ON "sale_payments"  ("saleId") `);
    await queryRunner.query(`CREATE INDEX "IDX_e4c205c0fb27992aa69eb4dcbd" ON "sale_payments"  ("paymentMethodId") `);
    await queryRunner.query(`ALTER TABLE "sale_payments" ADD CONSTRAINT "FK_ad8e4736c560dc015611d3b7fc2" FOREIGN KEY ("saleId") REFERENCES "sales"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`);
    await queryRunner.query(`ALTER TABLE "sale_payments" ADD CONSTRAINT "FK_e4c205c0fb27992aa69eb4dcbde" FOREIGN KEY ("paymentMethodId") REFERENCES "payment_methods"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`);
    await queryRunner.query(`ALTER TABLE "sale_payments" ADD CONSTRAINT "FK_d99b3f0c6e528db01e8aa68ee72" FOREIGN KEY ("receivedBy") REFERENCES "users"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    assertDestructiveDownAllowed(this.name);
    await queryRunner.query(`ALTER TABLE "sale_payments" DROP CONSTRAINT "FK_d99b3f0c6e528db01e8aa68ee72"`);
    await queryRunner.query(`ALTER TABLE "sale_payments" DROP CONSTRAINT "FK_e4c205c0fb27992aa69eb4dcbde"`);
    await queryRunner.query(`ALTER TABLE "sale_payments" DROP CONSTRAINT "FK_ad8e4736c560dc015611d3b7fc2"`);
    await queryRunner.query(`DROP INDEX "public"."IDX_e4c205c0fb27992aa69eb4dcbd"`);
    await queryRunner.query(`DROP INDEX "public"."IDX_ad8e4736c560dc015611d3b7fc"`);
    await queryRunner.query(`DROP TABLE "sale_payments"`);
  }
}
