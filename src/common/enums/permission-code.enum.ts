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
  // Ver el inventario y pedir que se borre una referencia, sin poder borrarla directo: la pide
  // quien maneja el stock o vende (bodega, vendedor, caja) y la resuelve quien tiene
  // INVENTORY_MANAGE_PRODUCTS.
  INVENTORY_REQUEST_DELETION = 'inventory.request_deletion',
}
