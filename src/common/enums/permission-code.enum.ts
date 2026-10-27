// Códigos del catálogo de permisos (ver las migraciones seed_permission). Se agregan acá a
// medida que una operación los exige: así un código mal escrito en @RequirePermissions
// falla al compilar en vez de dejar la operación inaccesible para todos.
export enum PermissionCode {
  USERS_MANAGE = 'users.manage',
  SETTINGS_MANAGE = 'settings.manage',
  // Las tres secciones del menú que todavía no tienen pantalla propia: ninguna operación las
  // exige todavía. Están en el catálogo para que cada empresa decida, en "Roles y permisos", qué
  // roles ven el dashboard, la sección Pedidos y los reportes; cuando se construya cada pantalla,
  // es con estos códigos con los que se sirve. Ver TODOS los pedidos de la empresa sigue siendo
  // ORDERS_VIEW_ALL: ORDERS_VIEW es solo entrar a la sección.
  DASHBOARD_VIEW = 'dashboard.view',
  ORDERS_VIEW = 'orders.view',
  REPORTS_VIEW = 'reports.view',
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
  // Cobrar en caja una orden de venta (SO) que el vendedor dejó pendiente de pago. Sembrado desde
  // V0.2 para Caja; también lo cubre CASH_REGISTER_PAYMENT.
  CASH_CHARGE_ORDERS = 'cash.charge_orders',
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
  // Solo ver el inventario (existencias), sin modificar nada: lo tienen Bodega, Vendedor
  // y Caja. Todo lo que cambia el inventario sigue pidiendo INVENTORY_MANAGE_PRODUCTS (solo Admin).
  INVENTORY_VIEW = 'inventory.view',
  // El módulo de Transferencias completo: ver los traslados entre tiendas y bodegas Y registrarlos.
  // Es el único permiso que los habilita (no hace falta INVENTORY_MANAGE_PRODUCTS): quien no lo
  // tiene no ve ni la tarjeta ni el historial, y el servidor le rechaza el movimiento TRANSFER.
  // Por defecto solo Administrador y super administrador. Nace en V1.4_seed_inventory_transfer_permission.
  INVENTORY_TRANSFER = 'inventory.transfer',

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
  // Armar una orden de compra y enviarla. Lo tienen el Administrador (le pide al proveedor) y el
  // Proveedor (arma la orden de lo que va a entregar): el proveedor solo puede armarla a su nombre
  // y solo toca las suyas, lo revisa el servidor. Antes esto lo gobernaba
  // INVENTORY_MANAGE_PRODUCTS, que mezclaba comprar con manejar el inventario: dárselo al proveedor
  // le habría abierto además los movimientos de inventario. Nace en
  // V1.6_seed_purchase_order_manage_permission.
  SUPPLIERS_MANAGE_PURCHASE_ORDERS = 'suppliers.manage_purchase_orders',
  // El proveedor, sobre SU PROPIA orden de compra: contarla y despacharla. Ya no hay un paso de
  // "confirmar" aparte (revisar la orden es parte de despacharla), así que
  // suppliers.confirm_purchase_order se retira del catálogo en
  // V1.7_rework_purchase_order_permissions. Quien recibe la mercancía es el bodeguero, con
  // WAREHOUSE_FULFILL_ORDERS: el proveedor ya no se firma a sí mismo la llegada.
  SUPPLIERS_REGISTER_DELIVERY = 'suppliers.register_delivery',
  // El proveedor da de alta referencias nuevas (producto + variante) sin necesitar
  // INVENTORY_MANAGE_PRODUCTS, que además le permitiría mover inventario por fuera de una orden de
  // compra. Nace en V1.3_seed_supplier_create_references_permission.
  SUPPLIERS_CREATE_REFERENCES = 'suppliers.create_references',
}
