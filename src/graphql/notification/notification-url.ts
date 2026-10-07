import { NotificationEntityType } from './entities/notification-entity-type.enum.js';

// Las rutas de la app (ver ROUTES en el front). El aviso del sistema las abre al tocarlo.
const ROUTE = {
  purchaseOrders: '/purchase-orders',
  notifications: '/notifications',
  inventory: '/inventory',
  cash: '/cash',
} as const;

/**
 * A dónde lleva un aviso del sistema al tocarlo: la orden de compra que menciona, o la pantalla de su
 * tema. Va con la empresa: el dispositivo puede estar trabajando con otra, y la app la cambia al abrir.
 */
export function notificationUrl(entityType: NotificationEntityType, entityId: string, companyId: string): string {
  const company = `company=${encodeURIComponent(companyId)}`;
  switch (entityType) {
    case NotificationEntityType.PURCHASE_ORDER:
      return `${ROUTE.purchaseOrders}?order=${encodeURIComponent(entityId)}&${company}`;
    case NotificationEntityType.INVENTORY_BALANCE:
      return `${ROUTE.inventory}?${company}`;
    case NotificationEntityType.CASH_SESSION:
      return `${ROUTE.cash}?${company}`;
    default:
      return `${ROUTE.notifications}?${company}`;
  }
}
