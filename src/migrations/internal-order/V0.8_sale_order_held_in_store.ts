import { MigrationInterface, QueryRunner } from 'typeorm';

// Un pedido de venta puede nacer en la misma tienda que lo pide.
//
// `CHK_internal_orders_route` (V0.2) exigía origen distinto de destino: cuando se escribió, toda
// orden interna era un viaje de un corredor entre dos sedes. Desde que lo que la tienda YA tiene no
// se le pide a bodega (ver `createHeldBySeller`), hay una SO que no es un viaje: nace RECIBIDA, en
// manos del vendedor, con la tienda como origen y como destino, y lo pedido queda apartado ahí
// mismo para ese cliente. La restricción la rechazaba, así que pedir algo que estaba en el
// mostrador fallaba con "violates check constraint CHK_internal_orders_route".
//
// La regla pasa a ser: un viaje sigue siendo entre dos sedes distintas (TR, RS, RE), y la SO es la
// excepción, porque es la única que puede no moverse de sitio.
export class SaleOrderHeldInStore1791900000052 implements MigrationInterface {
  name = 'SaleOrderHeldInStore1791900000052';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "internal_orders" DROP CONSTRAINT "CHK_internal_orders_route"`);
    await queryRunner.query(`
      ALTER TABLE "internal_orders"
      ADD CONSTRAINT "CHK_internal_orders_route"
      CHECK ("sourceLocationId" <> "destinationLocationId" OR "type" = 'SO')
    `);
  }

  // Vuelve a exigir dos sedes distintas para todo. Si ya hay pedidos nacidos en la tienda, Postgres
  // rechaza la restricción y la reversión falla: esos pedidos son datos reales de ventas, no se
  // borran aquí.
  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "internal_orders" DROP CONSTRAINT "CHK_internal_orders_route"`);
    await queryRunner.query(`
      ALTER TABLE "internal_orders"
      ADD CONSTRAINT "CHK_internal_orders_route"
      CHECK ("sourceLocationId" <> "destinationLocationId")
    `);
  }
}
