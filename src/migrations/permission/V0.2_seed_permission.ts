import { MigrationInterface, QueryRunner } from 'typeorm';

// Catálogo real de permisos por módulo (código en forma "modulo.accion").
// Timestamp +1 día: debe correr después de la migración de esquema de "permission" (V0.1).
export class SeedPermission1789598255955 implements MigrationInterface {
  name = 'SeedPermission1789598255955';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      INSERT INTO "permissions" ("id", "code", "name", "module", "status")
      VALUES
        ('30000000-0000-4000-8000-000000000001', 'sales.create', 'Crear ventas', 'SALES', 'ACTIVE'),
        ('30000000-0000-4000-8000-000000000002', 'users.manage', 'Gestionar usuarios', 'USERS', 'ACTIVE'),
        ('30000000-0000-4000-8000-000000000003', 'orders.view_all', 'Ver todos los pedidos', 'ORDERS', 'ACTIVE'),
        ('30000000-0000-4000-8000-000000000004', 'orders.request_from_warehouse', 'Solicitar productos a bodega', 'ORDERS', 'ACTIVE'),
        ('30000000-0000-4000-8000-000000000005', 'orders.confirm_receipt', 'Confirmar recepción de pedidos', 'ORDERS', 'ACTIVE'),
        ('30000000-0000-4000-8000-000000000006', 'inventory.approve_writeoff', 'Autorizar bajas de inventario', 'INVENTORY', 'ACTIVE'),
        ('30000000-0000-4000-8000-000000000007', 'inventory.resolve_adjustments', 'Resolver ajustes de stock', 'INVENTORY', 'ACTIVE'),
        ('30000000-0000-4000-8000-000000000008', 'inventory.request_adjustment', 'Solicitar ajuste de stock', 'INVENTORY', 'ACTIVE'),
        ('30000000-0000-4000-8000-000000000009', 'inventory.report_returns', 'Reportar devoluciones', 'INVENTORY', 'ACTIVE'),
        ('30000000-0000-4000-8000-000000000010', 'warehouse.fulfill_orders', 'Alistar y despachar pedidos', 'WAREHOUSE', 'ACTIVE'),
        ('30000000-0000-4000-8000-000000000011', 'warehouse.receive_returns', 'Recibir devoluciones en bodega', 'WAREHOUSE', 'ACTIVE'),
        ('30000000-0000-4000-8000-000000000012', 'runner.pickup_orders', 'Tomar pedidos para transporte', 'RUNNER', 'ACTIVE'),
        ('30000000-0000-4000-8000-000000000013', 'runner.confirm_delivery', 'Confirmar entregas', 'RUNNER', 'ACTIVE'),
        ('30000000-0000-4000-8000-000000000014', 'runner.report_incident', 'Reportar novedades de traslado', 'RUNNER', 'ACTIVE'),
        ('30000000-0000-4000-8000-000000000015', 'cash.charge_orders', 'Cobrar pedidos', 'CASH', 'ACTIVE'),
        ('30000000-0000-4000-8000-000000000016', 'cash.register_payment', 'Registrar pagos y descuentos', 'CASH', 'ACTIVE'),
        ('30000000-0000-4000-8000-000000000017', 'cash.open_close_shift', 'Abrir y cerrar caja', 'CASH', 'ACTIVE'),
        ('30000000-0000-4000-8000-000000000018', 'suppliers.confirm_purchase_order', 'Confirmar órdenes de compra', 'SUPPLIERS', 'ACTIVE'),
        ('30000000-0000-4000-8000-000000000019', 'suppliers.register_delivery', 'Registrar entrega de proveedor', 'SUPPLIERS', 'ACTIVE'),
        ('30000000-0000-4000-8000-000000000020', 'settings.manage', 'Gestionar configuración', 'SETTINGS', 'ACTIVE')
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      DELETE FROM "permissions" WHERE "id" LIKE '30000000-0000-4000-8000-%'
    `);
  }
}
