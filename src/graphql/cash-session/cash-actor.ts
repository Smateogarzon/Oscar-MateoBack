import { PermissionCode } from '../../common/enums/permission-code.enum.js';

// Quién opera la caja y hasta dónde llega. Lo arman los resolvers desde los permisos de la empresa
// activa y lo usan los servicios de turnos, movimientos y cobro.
export interface CashActor {
  userId: string;
  // Ve los turnos y movimientos de todos los cajeros
  canViewAll: boolean;
  // Abre y cierra turnos y maneja su código: el administrador
  canManageShifts: boolean;
}

// Quien abre y cierra turnos también los ve todos: lo necesita para hacer su trabajo.
export function cashActor(userId: string, permissionCodes: string[]): CashActor {
  const canManageShifts = permissionCodes.includes(PermissionCode.CASH_OPEN_CLOSE_SHIFT);
  return {
    userId,
    canManageShifts,
    canViewAll: canManageShifts || permissionCodes.includes(PermissionCode.CASH_VIEW_ALL),
  };
}
