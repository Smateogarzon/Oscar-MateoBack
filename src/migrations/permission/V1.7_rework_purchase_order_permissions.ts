import { MigrationInterface, QueryRunner } from 'typeorm';

// El recorrido nuevo de las órdenes de compra (ver V0.3_rework_purchase-order-flow) reparte los
// permisos así:
//   suppliers.manage_purchase_orders  el administrador la arma y la envía (sin cambios)
//   suppliers.register_delivery       el PROVEEDOR la cuenta y la despacha; pasa a llamarse
//                                     "Despachar órdenes de compra", que es lo que hace ahora:
//                                     ya no es él quien declara que la mercancía llegó
//   warehouse.fulfill_orders          el BODEGUERO la cuenta al recibirla y la acepta; con eso
//                                     entra la existencia al inventario. Es el mismo permiso con
//                                     el que bodega alista y despacha pedidos internos, por
//                                     decisión del usuario: quien maneja la bodega maneja lo que
//                                     entra a la bodega, sin un permiso más que repartir.
//
// Y sale del catálogo suppliers.confirm_purchase_order: no hay un paso de confirmar aparte, porque
// revisar la orden es parte de despacharla. Se borra en vez de dejarlo huérfano para que no quede
// en "Roles y permisos" un permiso que no habilita nada.
export class ReworkPurchaseOrderPermissions1791900000002 implements MigrationInterface {
  name = 'ReworkPurchaseOrderPermissions1791900000002';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      DELETE FROM "role_permissions" WHERE "permissionId" IN (
        SELECT "id" FROM "permissions" WHERE "code" = 'suppliers.confirm_purchase_order'
      )
    `);
    await queryRunner.query(`DELETE FROM "permissions" WHERE "code" = 'suppliers.confirm_purchase_order'`);

    await queryRunner.query(`
      UPDATE "permissions" SET "name" = 'Despachar órdenes de compra'
      WHERE "code" = 'suppliers.register_delivery'
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      UPDATE "permissions" SET "name" = 'Registrar entrega de proveedor'
      WHERE "code" = 'suppliers.register_delivery'
    `);

    await queryRunner.query(`
      INSERT INTO "permissions" ("id", "code", "name", "module", "status")
      VALUES ('30000000-0000-4000-8000-000000000018', 'suppliers.confirm_purchase_order', 'Confirmar órdenes de compra', 'SUPPLIERS', 'ACTIVE')
      ON CONFLICT DO NOTHING
    `);
    await queryRunner.query(`
      INSERT INTO "role_permissions" ("roleId", "permissionId", "companyId")
      SELECT r."id", p."id", c."id"
      FROM "roles" r
      JOIN "permissions" p ON p."code" = 'suppliers.confirm_purchase_order'
      CROSS JOIN "companies" c
      WHERE r."code" = 'SUPPLIER'
      ON CONFLICT DO NOTHING
    `);
  }
}
