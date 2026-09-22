import { PermissionCode } from '../../common/enums/permission-code.enum.js';

// Quién consulta el histórico de ventas y hasta dónde llega. Lo arma el resolver desde los
// permisos de la empresa activa y lo usa SaleService.findAll. Mismo patrón que CashActor.
export interface SaleActor {
  userId: string;
  // Ve las ventas de todos los cajeros y vendedores
  canViewAll: boolean;
}

export function saleActor(userId: string, permissionCodes: string[]): SaleActor {
  return {
    userId,
    canViewAll: permissionCodes.includes(PermissionCode.SALES_VIEW_ALL),
  };
}
