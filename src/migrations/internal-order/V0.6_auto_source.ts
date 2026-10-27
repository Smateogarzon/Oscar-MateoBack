import { MigrationInterface, QueryRunner } from 'typeorm';
import { assertDestructiveDownAllowed } from '../../config/destructive-down.js';

// El sistema decide de dónde sale la mercancía y nadie dice ya a dónde llega dentro de la tienda
// (acordado con el usuario, 2026-10-15). Dos cambios:
//
//   · se borra "deliveryPoint": el punto de entrega dentro del destino ("Probador #02") ya no se
//     pide al pedir ni se muestra en ninguna parte, así que la columna sobra. Es destructivo: lo que
//     tuvieran las órdenes viejas se pierde.
//   · entra "requestGroupId": cuando lo que pide un vendedor está repartido en varias bodegas se
//     crea una orden por bodega, y todas las de un mismo envío comparten este id. Sirve para
//     volverlas a encontrar juntas (el reintento de una petición idempotente devuelve el grupo
//     entero, no solo la primera). Una orden que nació sola también lo lleva.
export class InternalOrderAutoSource1791900000023 implements MigrationInterface {
  name = 'InternalOrderAutoSource1791900000023';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "internal_orders" DROP COLUMN "deliveryPoint"`);
    await queryRunner.query(`ALTER TABLE "internal_orders" ADD "requestGroupId" uuid`);
    await queryRunner.query(`CREATE INDEX "IDX_internal_orders_requestGroupId" ON "internal_orders" ("requestGroupId")`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    assertDestructiveDownAllowed(this.name);
    await queryRunner.query(`DROP INDEX "public"."IDX_internal_orders_requestGroupId"`);
    await queryRunner.query(`ALTER TABLE "internal_orders" DROP COLUMN "requestGroupId"`);
    // Vuelve la columna, vacía: el punto de entrega de las órdenes viejas no se puede recuperar.
    await queryRunner.query(`ALTER TABLE "internal_orders" ADD "deliveryPoint" character varying(80)`);
  }
}
