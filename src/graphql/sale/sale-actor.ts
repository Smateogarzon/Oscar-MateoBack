import { PermissionCode } from '../../common/enums/permission-code.enum.js';

// Quién consulta ventas y hasta dónde llega. Lo arma el resolver desde los permisos de la empresa
// activa y lo usan SaleService y los servicios de lo que cuelga de una venta (pagos, solicitudes de
// descuento, devoluciones). Mismo patrón que CashActor.
export interface SaleActor {
  userId: string;
  // Ve el histórico de ventas de todos los cajeros y vendedores (sales.view_all)
  canViewAll: boolean;
  // Puede leer cualquier venta por su id: quien ve todo, y quien aprueba descuentos o devoluciones (para
  // resolver una solicitud hay que poder ver la venta a la que se refiere). Sin esto, cada quien lee
  // solo las ventas que cobró o vendió y lo que cuelga de ellas; lo demás responde como si no existiera.
  canReadAny: boolean;
}

export function saleActor(userId: string, permissionCodes: string[]): SaleActor {
  const canViewAll = permissionCodes.includes(PermissionCode.SALES_VIEW_ALL);
  return {
    userId,
    canViewAll,
    canReadAny:
      canViewAll ||
      permissionCodes.includes(PermissionCode.SALES_APPROVE_DISCOUNT) ||
      permissionCodes.includes(PermissionCode.SALES_APPROVE_RETURN),
  };
}

// ¿Esta venta es de quien pregunta? La cobró (cajero) o la vendió (vendedor).
export function isOwnSale(actor: { userId: string }, sale: { cashierId: string; sellerId: string | null }): boolean {
  return sale.cashierId === actor.userId || sale.sellerId === actor.userId;
}

// ¿Puede quien pregunta leer esta venta?
export function canReadSale(actor: SaleActor, sale: { cashierId: string; sellerId: string | null }): boolean {
  return actor.canReadAny || isOwnSale(actor, sale);
}
