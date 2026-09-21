import { MigrationInterface, QueryRunner } from 'typeorm';

// Qué medios de pago acepta cada tienda (ver StorePaymentMethod). Escrita a mano, con los nombres
// de índice y de clave foránea legibles.
export class AddStorePaymentMethod1789940000000 implements MigrationInterface {
  name = 'AddStorePaymentMethod1789940000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`CREATE TABLE "store_payment_methods" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "storeId" uuid NOT NULL, "paymentMethodId" uuid NOT NULL, "status" "public"."record_status" NOT NULL DEFAULT 'ACTIVE', CONSTRAINT "PK_store_payment_methods" PRIMARY KEY ("id"))`);
    await queryRunner.query(`CREATE UNIQUE INDEX "IDX_store_payment_methods_store_method" ON "store_payment_methods" ("storeId", "paymentMethodId")`);
    await queryRunner.query(`ALTER TABLE "store_payment_methods" ADD CONSTRAINT "FK_store_payment_methods_store" FOREIGN KEY ("storeId") REFERENCES "locations"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`);
    await queryRunner.query(`ALTER TABLE "store_payment_methods" ADD CONSTRAINT "FK_store_payment_methods_payment_method" FOREIGN KEY ("paymentMethodId") REFERENCES "payment_methods"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "store_payment_methods" DROP CONSTRAINT "FK_store_payment_methods_payment_method"`);
    await queryRunner.query(`ALTER TABLE "store_payment_methods" DROP CONSTRAINT "FK_store_payment_methods_store"`);
    await queryRunner.query(`DROP INDEX "public"."IDX_store_payment_methods_store_method"`);
    await queryRunner.query(`DROP TABLE "store_payment_methods"`);
  }
}
