// Códigos del catálogo de permisos (ver las migraciones seed_permission). Se agregan acá a
// medida que una operación los exige: así un código mal escrito en @RequirePermissions
// falla al compilar en vez de dejar la operación inaccesible para todos.
export enum PermissionCode {
  USERS_MANAGE = 'users.manage',
  SETTINGS_MANAGE = 'settings.manage',
  SALES_CREATE = 'sales.create',
  SALES_VIEW = 'sales.view',
  SALES_CANCEL = 'sales.cancel',
  SALES_APPROVE_DISCOUNT = 'sales.approve_discount',
  CASH_OPEN_CLOSE_SHIFT = 'cash.open_close_shift',
  CASH_REGISTER_PAYMENT = 'cash.register_payment',
  CASH_VIEW_ALL = 'cash.view_all',
  // Registrar la devolución de una venta ya cobrada y entregar el reembolso (el cajero).
  SALES_RETURN = 'sales.return',
  // Aprobar o rechazar una devolución (el administrador).
  SALES_APPROVE_RETURN = 'sales.approve_return',
}
