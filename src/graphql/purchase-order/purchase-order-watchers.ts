import { In, type EntityManager } from 'typeorm';
import { usersWithStoreAccess } from '../../common/access/store-access.js';
import { PermissionCode } from '../../common/enums/permission-code.enum.js';
import { IncidentStatus } from '../incident/entities/incident-status.enum.js';
import { Incident } from '../incident/entities/incident.entity.js';
import { NotificationChannel } from '../notification/entities/notification-channel.enum.js';
import { NotificationEntityType } from '../notification/entities/notification-entity-type.enum.js';
import { NotificationType } from '../notification/entities/notification-type.enum.js';
import type { NotificationService } from '../notification/notification.service.js';
import { RoleScope } from '../role/entities/role-scope.enum.js';
import { PurchaseOrderStatus as POS } from './entities/purchase-order-status.enum.js';
import type { PurchaseOrder } from './entities/purchase-order.entity.js';
import { PurchaseOrderItem } from './entities/purchase-order-item.entity.js';

// El aviso de una orden con incidencia sigue pendiente mientras le quede alguna novedad abierta (de
// cualquiera de sus líneas, de despacho o de recepción). Cuando ya no le queda ninguna, se marca como
// leído: sale de pendientes. Lo llaman cada vez que una novedad de la orden se cierra o se cancela.
export async function settlePurchaseOrderIncidentNotices(
  manager: EntityManager,
  notifications: NotificationService,
  purchaseOrderId: string,
): Promise<void> {
  const items = await manager
    .getRepository(PurchaseOrderItem)
    .find({ select: { id: true }, where: { purchaseOrderId } });
  const itemIds = items.map((item) => item.id);
  if (itemIds.length > 0) {
    const open = await manager.getRepository(Incident).count({
      where: {
        entityType: 'PURCHASE_ORDER_ITEM',
        entityId: In(itemIds),
        status: In([IncidentStatus.OPEN, IncidentStatus.IN_REVIEW]),
      },
    });
    if (open > 0) return;
  }
  await notifications.markEntityRead(manager, NotificationEntityType.PURCHASE_ORDER, purchaseOrderId, [
    NotificationType.PURCHASE_ORDER_INCIDENT,
  ]);
}

// La orden llegó con una incidencia (de despacho o de recepción): avisa a quien arma las compras de
// la empresa para que la resuelva desde su bandeja. Es un aviso de verdad (queda en Notificaciones),
// no solo una señal en vivo. Va en la misma transacción que el despacho o la recepción.
export async function notifyPurchaseOrderIncident(
  manager: EntityManager,
  notifications: NotificationService,
  companyId: string,
  purchaseOrder: PurchaseOrder,
  actorId: string,
): Promise<void> {
  const recipientIds = await notifications.findUserIdsWithPermission(
    manager,
    companyId,
    PermissionCode.SUPPLIERS_MANAGE_PURCHASE_ORDERS,
    { scope: RoleScope.COMPANY },
  );
  await notifications.notify(manager, {
    companyId,
    type: NotificationType.PURCHASE_ORDER_INCIDENT,
    recipientIds,
    actorId,
    entityType: NotificationEntityType.PURCHASE_ORDER,
    entityId: purchaseOrder.id,
    locationId: purchaseOrder.destinationLocationId,
    reference: purchaseOrder.orderNumber,
  });
}

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
//
// "Bodega" es la bodega A LA QUE ENTRA ESTA orden, no todas las de la empresa: quien no la tiene
// asignada tampoco la ve ni la recibe (ver purchase-order-visibility.ts), así que avisarle solo le
// daba un aviso que al tocarlo no lleva a ninguna parte.
async function audienceIds(
  manager: EntityManager,
  notifications: NotificationService,
  companyId: string,
  destinationLocationId: string,
): Promise<{ purchasing: string[]; warehouse: string[] }> {
  const purchasing = await notifications.findUserIdsWithPermission(
    manager,
    companyId,
    PermissionCode.SUPPLIERS_MANAGE_PURCHASE_ORDERS,
    { scope: RoleScope.COMPANY },
  );
  const keepers = await notifications.findUserIdsWithPermission(
    manager,
    companyId,
    PermissionCode.WAREHOUSE_FULFILL_ORDERS,
    { scope: RoleScope.COMPANY },
  );
  return { purchasing, warehouse: await usersWithStoreAccess(manager, keepers, destinationLocationId) };
}

// Hasta cuándo un aviso de una orden de compra le sigue pidiendo algo a alguien. Mismo problema que
// en los pedidos internos: el aviso va a toda una audiencia (el proveedor, compras, toda la bodega)
// y solo salía de pendientes para quien lo abría, así que una orden ya recibida seguía pidiéndole a
// bodega que la recibiera.
//
// Solo entran los avisos que un estado POSTERIOR deja sin sentido. Los que anuncian lo último que
// pasó (PURCHASE_ORDER_RECEIVED, PURCHASE_ORDER_CANCELLED) no tienen un después que los invalide:
// esperan a que se abran, como ORDER_CANCELLED. PURCHASE_ORDER_INCIDENT tiene su propia regla (sigue
// pendiente mientras le quede una novedad abierta: ver `settlePurchaseOrderIncidentNotices`).
const PO_NOTICE_ALIVE_WHILE: ReadonlyArray<readonly [NotificationType, readonly POS[]]> = [
  // el proveedor: despáchala · hasta que la despacha (o se anula)
  [NotificationType.PURCHASE_ORDER_SENT, [POS.DRAFT, POS.SENT, POS.PENDING_APPROVAL]],
  // compras: autoriza el sobrante · hasta que lo resuelve
  [NotificationType.PURCHASE_ORDER_OVERAGE_PENDING, [POS.PENDING_APPROVAL]],
  // bodega: va en camino, recíbela · hasta que la recibe (o se anula)
  [NotificationType.PURCHASE_ORDER_SHIPPED, [POS.SHIPPED]],
];

// Liquida los avisos de la orden que su estado dejó sin nada que pedir. Lo llama
// `announcePurchaseOrderChange`, por donde pasa todo cambio de la orden, antes de dejar los avisos
// del paso nuevo: así el nuevo no se liquida junto con los viejos.
export async function settlePurchaseOrderNotices(
  manager: EntityManager,
  notifications: NotificationService,
  purchaseOrder: PurchaseOrder,
): Promise<void> {
  const settled = PO_NOTICE_ALIVE_WHILE.filter(([, aliveWhile]) => !aliveWhile.includes(purchaseOrder.status)).map(([type]) => type);
  if (settled.length === 0) return;
  await notifications.markEntityRead(manager, NotificationEntityType.PURCHASE_ORDER, purchaseOrder.id, settled);
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
  // El paso que pedían los avisos del estado anterior ya lo dio alguien: dejan de estar pendientes
  // para todos los que no los abrieron.
  await settlePurchaseOrderNotices(manager, notifications, purchaseOrder);

  const { purchasing, warehouse } = await audienceIds(manager, notifications, companyId, purchaseOrder.destinationLocationId);
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
