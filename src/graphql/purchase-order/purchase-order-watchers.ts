import type { EntityManager } from 'typeorm';
import { PermissionCode } from '../../common/enums/permission-code.enum.js';
import { NotificationChannel } from '../notification/entities/notification-channel.enum.js';
import { NotificationEntityType } from '../notification/entities/notification-entity-type.enum.js';
import { NotificationType } from '../notification/entities/notification-type.enum.js';
import type { NotificationService } from '../notification/notification.service.js';
import { RoleScope } from '../role/entities/role-scope.enum.js';
import type { PurchaseOrder } from './entities/purchase-order.entity.js';

// Una orden de compra pasa por tres manos: la arma el administrador, la cuenta y la despacha el
// proveedor, y la recibe contándola el bodeguero (cualquiera de los dos primeros la cancela). Cada
// paso se avisa de dos maneras:
//  - Aviso guardado (campanita y push): solo a quien le toca actuar o enterarse, con el tipo que dice
//    qué pasó. Esta es la tabla de audiencias de cada paso (ver el servicio).
//  - Señal en vivo (canal PURCHASING, sin crear aviso): para quien sigue la orden y no recibió aviso,
//    para que su pantalla se ponga al día sola. Igual que los turnos de caja.
// Todo sale solo si la transacción se confirma, y nada de esto lleva montos: el mismo texto lo ven
// varias audiencias.

export type PurchaseOrderAudience = 'SUPPLIER' | 'PURCHASING' | 'WAREHOUSE';

export interface PurchaseOrderAnnouncement {
  type: NotificationType;
  // A quiénes se les guarda el aviso (y le llega el push).
  to: PurchaseOrderAudience[];
  notes?: string | null;
}

// Los usuarios que quedan en cada audiencia. El proveedor es el de la orden (siempre la sigue); la
// empresa y bodega son quienes tienen el permiso dentro de la empresa (scope COMPANY: otros proveedores
// no se enteran de órdenes ajenas). El super admin entra siempre (findUserIdsWithPermission).
async function audienceIds(
  manager: EntityManager,
  notifications: NotificationService,
  companyId: string,
): Promise<{ purchasing: string[]; warehouse: string[] }> {
  const purchasing = await notifications.findUserIdsWithPermission(
    manager,
    companyId,
    PermissionCode.SUPPLIERS_MANAGE_PURCHASE_ORDERS,
    { scope: RoleScope.COMPANY },
  );
  const warehouse = await notifications.findUserIdsWithPermission(
    manager,
    companyId,
    PermissionCode.WAREHOUSE_FULFILL_ORDERS,
    { scope: RoleScope.COMPANY },
  );
  return { purchasing, warehouse };
}

// Avisa de un cambio de la orden: guarda cada aviso que corresponda y manda la señal en vivo a quien
// siguió la orden pero no recibió aviso. Un usuario que cae en dos audiencias (el administrador tiene
// compras y bodega) recibe un solo aviso por evento: notify() ya deduplica por destinatario.
export async function announcePurchaseOrderChange(
  manager: EntityManager,
  notifications: NotificationService,
  companyId: string,
  purchaseOrder: PurchaseOrder,
  actorId: string,
  announcements: readonly PurchaseOrderAnnouncement[] = [],
): Promise<void> {
  const { purchasing, warehouse } = await audienceIds(manager, notifications, companyId);
  const byAudience: Record<PurchaseOrderAudience, string[]> = {
    SUPPLIER: [purchaseOrder.supplierId],
    PURCHASING: purchasing,
    WAREHOUSE: warehouse,
  };

  const notified = new Set<string>();
  for (const announcement of announcements) {
    const result = await notifications.notify(manager, {
      companyId,
      type: announcement.type,
      recipientIds: announcement.to.flatMap((audience) => byAudience[audience]),
      actorId,
      entityType: NotificationEntityType.PURCHASE_ORDER,
      entityId: purchaseOrder.id,
      locationId: purchaseOrder.destinationLocationId,
      reference: purchaseOrder.orderNumber,
      notes: announcement.notes,
    });
    for (const id of result?.recipientIds ?? []) notified.add(id);
  }

  // Quien sigue la orden (el proveedor, quien la armó y las dos audiencias) y no recibió aviso igual
  // ve el cambio en su pantalla, sin campanita.
  const followers = [purchaseOrder.supplierId, purchaseOrder.createdBy, ...purchasing, ...warehouse];
  notifications.signalChange(manager, {
    companyId,
    channel: NotificationChannel.PURCHASING,
    entityType: NotificationEntityType.PURCHASE_ORDER,
    entityId: purchaseOrder.id,
    recipientIds: followers.filter((id) => !notified.has(id)),
    exceptUserId: actorId,
  });
}
