// Códigos del catálogo de permisos (ver la migración seed_permission). Se agregan acá a
// medida que una operación los exige: así un código mal escrito en @RequirePermissions
// falla al compilar en vez de dejar la operación inaccesible para todos.
export enum PermissionCode {
  USERS_MANAGE = 'users.manage',
  SETTINGS_MANAGE = 'settings.manage',
}
