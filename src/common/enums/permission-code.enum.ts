// Códigos del catálogo de permisos (ver las migraciones seed_permission). Se agregan acá a
// medida que una operación los exige: así un código mal escrito en @RequirePermissions
// falla al compilar en vez de dejar la operación inaccesible para todos.
export enum PermissionCode {
  USERS_MANAGE = 'users.manage',
  SETTINGS_MANAGE = 'settings.manage',
  SALES_CREATE = 'sales.create',
  SALES_VIEW = 'sales.view',
  // Ver el histórico de ventas de TODOS los cajeros y vendedores; sin él, cada quien ve solo las
  // suyas (las que cobró o las que vendió).
  SALES_VIEW_ALL = 'sales.view_all',
  SALES_CANCEL = 'sales.cancel',
  SALES_APPROVE_DISCOUNT = 'sales.approve_discount',
  CASH_OPEN_CLOSE_SHIFT = 'cash.open_close_shift',
  CASH_REGISTER_PAYMENT = 'cash.register_payment',
  CASH_VIEW_ALL = 'cash.view_all',
  // Registrar la devolución de una venta ya cobrada y entregar el reembolso (el cajero).
  SALES_RETURN = 'sales.return',
  // Aprobar o rechazar una devolución (el administrador).
  SALES_APPROVE_RETURN = 'sales.approve_return',
  // Crear y editar las MARCAS: son compartidas entre empresas (ver brand.entity.ts), así que por
  // defecto solo lo tiene el super administrador — ninguna empresa le cambia a otra el nombre o el
  // logo de una marca que ambas usan.
  INVENTORY_MANAGE_CATALOG = 'inventory.manage_catalog',
  // Crear y editar categorías, productos, sus variantes y los colores/tallas que usan: todo lo
  // que es propio de cada empresa (a diferencia de las marcas, compartidas). Por defecto lo tienen
  // el Administrador y el Bodeguero de cada empresa (quien recibe mercancía nueva es quien más lo
  // usa), además del super administrador.
  INVENTORY_MANAGE_PRODUCTS = 'inventory.manage_products',
  // Solo ver el inventario (existencias, traslados), sin modificar nada: lo tienen Bodega, Vendedor
  // y Caja. Todo lo que cambia el inventario sigue pidiendo INVENTORY_MANAGE_PRODUCTS (solo Admin).
  INVENTORY_VIEW = 'inventory.view',

  // Los siguientes ya existían en la base desde la semilla original (V0.2, antes de que existiera
  // ningún módulo que los usara) y ya tienen reparto por rol (Vendedor/Bodega/Corredor/Proveedor):
  // se agregan acá tal cual, sin una migración nueva, al construir pedidos internos, órdenes de
  // compra y bajas de inventario.

  // Pedidos internos (internal_orders): pedir, ver todos y confirmar que lo pedido llegó.
  ORDERS_REQUEST_FROM_WAREHOUSE = 'orders.request_from_warehouse',
  ORDERS_VIEW_ALL = 'orders.view_all',
  ORDERS_CONFIRM_RECEIPT = 'orders.confirm_receipt',
  // Bodega: aceptar, alistar y despachar un pedido; recibir en bodega lo que vuelve de una devolución.
  WAREHOUSE_FULFILL_ORDERS = 'warehouse.fulfill_orders',
  WAREHOUSE_RECEIVE_RETURNS = 'warehouse.receive_returns',
  // Corredor: tomar un pedido listo para transportar y confirmar que lo entregó.
  RUNNER_PICKUP_ORDERS = 'runner.pickup_orders',
  RUNNER_CONFIRM_DELIVERY = 'runner.confirm_delivery',
  RUNNER_REPORT_INCIDENT = 'runner.report_incident',
  // Bajas de inventario (write_offs): pedir una (mismo permiso que pedir un ajuste de stock) y
  // aprobarla o rechazarla.
  INVENTORY_REQUEST_ADJUSTMENT = 'inventory.request_adjustment',
  INVENTORY_RESOLVE_ADJUSTMENTS = 'inventory.resolve_adjustments',
  INVENTORY_APPROVE_WRITEOFF = 'inventory.approve_writeoff',
  // El proveedor, sobre SU PROPIA orden de compra: confirmarla y registrar que la entregó.
  SUPPLIERS_CONFIRM_PURCHASE_ORDER = 'suppliers.confirm_purchase_order',
  SUPPLIERS_REGISTER_DELIVERY = 'suppliers.register_delivery',
}
