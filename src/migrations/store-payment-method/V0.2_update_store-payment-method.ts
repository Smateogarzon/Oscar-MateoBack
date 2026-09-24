import { MigrationInterface, QueryRunner } from 'typeorm';

export class UpdateStorePaymentMethod1790220768422 implements MigrationInterface {
  name = 'UpdateStorePaymentMethod1790220768422';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "store_payment_methods" DROP CONSTRAINT "FK_store_payment_methods_store"`);
    await queryRunner.query(`ALTER TABLE "store_payment_methods" DROP CONSTRAINT "FK_store_payment_methods_payment_method"`);
    await queryRunner.query(`CREATE UNIQUE INDEX "IDX_ec095064b4047a61fca3541b72" ON "store_payment_methods"  ("storeId", "paymentMethodId") `);
    await queryRunner.query(`ALTER TABLE "store_payment_methods" ADD CONSTRAINT "FK_bb97cff4af381ffae32cf3d0e0a" FOREIGN KEY ("storeId") REFERENCES "locations"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`);
    await queryRunner.query(`ALTER TABLE "store_payment_methods" ADD CONSTRAINT "FK_d0ad2b80cab6df4f051f170d2ee" FOREIGN KEY ("paymentMethodId") REFERENCES "payment_methods"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "store_payment_methods" DROP CONSTRAINT "FK_d0ad2b80cab6df4f051f170d2ee"`);
    await queryRunner.query(`ALTER TABLE "store_payment_methods" DROP CONSTRAINT "FK_bb97cff4af381ffae32cf3d0e0a"`);
    await queryRunner.query(`DROP INDEX "public"."IDX_ec095064b4047a61fca3541b72"`);
    await queryRunner.query(`CREATE UNIQUE INDEX "IDX_store_payment_methods_store_method" ON "store_payment_methods" USING btree ("paymentMethodId", "storeId") `);
    await queryRunner.query(`ALTER TABLE "store_payment_methods" ADD CONSTRAINT "FK_store_payment_methods_payment_method" FOREIGN KEY ("paymentMethodId") REFERENCES "payment_methods"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`);
    await queryRunner.query(`ALTER TABLE "store_payment_methods" ADD CONSTRAINT "FK_store_payment_methods_store" FOREIGN KEY ("storeId") REFERENCES "locations"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`);
  }
}
