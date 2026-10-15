// Códigos de los roles que siembra V0.2_seed_role (los mismos en todas las empresas). El código es
// el identificador estable para la lógica de negocio; el nombre es solo para mostrar. Igual que con
// PermissionCode, un código mal escrito falla al compilar en vez de dejar una regla sin efecto.
// Lo que puede hacer cada rol lo deciden los permisos (role_permissions); un código de rol solo se
// mira cuando es la IDENTIDAD la que cuenta (de qué proveedor es una orden, quién es super admin).
export enum RoleCode {
  // Rol de plataforma (alcance GLOBAL, se crea con `npm run create:admin`).
  SUPER_ADMIN = 'SUPER_ADMIN',
  ADMIN = 'ADMIN',
  SELLER = 'SELLER',
  WAREHOUSE = 'WAREHOUSE',
  RUNNER = 'RUNNER',
  CASHIER = 'CASHIER',
  // Alcance SUPPLIER: el proveedor solo ve y toca SUS órdenes de compra.
  SUPPLIER = 'SUPPLIER',
}
