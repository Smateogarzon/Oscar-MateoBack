import { In, type EntityManager } from 'typeorm';
import { PLATFORM_ROLE } from '../../common/access/platform-role.js';
import { PermissionCode } from '../../common/enums/permission-code.enum.js';
import { RecordStatus } from '../../common/enums/record-status.enum.js';
import { Location } from '../location/entities/location.entity.js';
import { NotificationChannel } from '../notification/entities/notification-channel.enum.js';
import { NotificationEntityType } from '../notification/entities/notification-entity-type.enum.js';
import { NotificationType } from '../notification/entities/notification-type.enum.js';
import type { NotificationService } from '../notification/notification.service.js';
import { UserCompanyRole } from '../user-company-role/entities/user-company-role.entity.js';
import { UserLocationAccess } from '../user-location-access/entities/user-location-access.entity.js';
import type { InternalOrder } from './entities/internal-order.entity.js';

// Una orden interna pasa por varias manos (quien la pide, bodega, el corredor, quien la recibe, la
// caja que la cobra) y cada paso tiene que verse en la pantalla de los demás sin recargar. Al
// cambiar se manda una señal en vivo (canal ORDERS, sin crear ningún aviso). Como todo lo que va en
// vivo, solo sale si la transacción se confirma y no lleva datos: quien la recibe vuelve a consultar.
export async function signalInternalOrderChange(
  manager: EntityManager,
  notifications: NotificationService,
  companyId: string,
  internalOrder: InternalOrder,
  actorId: string,
): Promise<void> {
  // Todos los que entran a la sección de pedidos (findUserIdsWithPermission ya incluye al super
  // admin), más la caja: una SO por cobrar aparece en la cola de Venta.
  const viewerIds = await notifications.findUserIdsWithPermission(manager, companyId, PermissionCode.ORDERS_VIEW);
  const cashierIds = await notifications.findUserIdsWithPermission(manager, companyId, PermissionCode.CASH_REGISTER_PAYMENT);

  notifications.signalChange(manager, {
    companyId,
    channel: NotificationChannel.ORDERS,
    entityType: NotificationEntityType.INTERNAL_ORDER,
    entityId: internalOrder.id,
    recipientIds: [
      // Quienes ya tienen la orden en la mano la siguen siempre, tengan el permiso que tengan hoy.
      ...[internalOrder.requestedBy, internalOrder.warehouseOperatorId, internalOrder.runnerId].filter(
        (id): id is string => !!id,
      ),
      ...viewerIds,
      ...cashierIds,
    ],
    exceptUserId: actorId,
  });
}

// A quién va cada aviso de una orden: a quien tiene que hacer el paso siguiente.
export type OrderNoticeAudience =
  // bodega: quien alista (y recibe devoluciones)
  | 'WAREHOUSE'
  // corredores: quien puede recoger
  | 'RUNNERS'
  // el corredor que la lleva
  | 'RUNNER'
  // quien la pidió
  | 'REQUESTER'
  // la caja de la tienda de destino
  | 'STORE_CASHIERS';

// Deja un aviso de verdad (bandeja de Notificaciones + aviso en vivo) en la misma transacción que el
// paso que lo provoca: si el paso se deshace, el aviso tampoco existe.
export async function notifyInternalOrder(
  manager: EntityManager,
  notifications: NotificationService,
  companyId: string,
  internalOrder: InternalOrder,
  type: NotificationType,
  audiences: readonly OrderNoticeAudience[],
  actorId: string,
  options: { notes?: string | null; locationId?: string } = {},
): Promise<void> {
  const recipientIds = new Set<string>();
  for (const audience of audiences) {
    for (const id of await recipientsOf(manager, notifications, companyId, internalOrder, audience)) recipientIds.add(id);
  }
  if (recipientIds.size === 0) return;

  const locationId = options.locationId ?? internalOrder.destinationLocationId;
  const location = await manager.getRepository(Location).findOneBy({ id: locationId });
  await notifications.notify(manager, {
    companyId,
    type,
    recipientIds: [...recipientIds],
    actorId,
    entityType: NotificationEntityType.INTERNAL_ORDER,
    entityId: internalOrder.id,
    locationId,
    reference: internalOrder.orderNumber,
    notes: options.notes,
    locationName: location?.name ?? null,
  });
}

async function recipientsOf(
  manager: EntityManager,
  notifications: NotificationService,
  companyId: string,
  order: InternalOrder,
  audience: OrderNoticeAudience,
): Promise<string[]> {
  switch (audience) {
    case 'WAREHOUSE':
      return notifications.findUserIdsWithPermission(manager, companyId, PermissionCode.WAREHOUSE_FULFILL_ORDERS);
    case 'RUNNERS':
      return notifications.findUserIdsWithPermission(manager, companyId, PermissionCode.RUNNER_PICKUP_ORDERS);
    case 'RUNNER':
      return order.runnerId ? [order.runnerId] : [];
    case 'REQUESTER':
      return order.requestedBy ? [order.requestedBy] : [];
    case 'STORE_CASHIERS': {
      const charge = await notifications.findUserIdsWithPermission(manager, companyId, PermissionCode.CASH_CHARGE_ORDERS);
      const pay = await notifications.findUserIdsWithPermission(manager, companyId, PermissionCode.CASH_REGISTER_PAYMENT);
      return withStoreAccess(manager, [...new Set([...charge, ...pay])], order.destinationLocationId);
    }
  }
}

// De `userIds`, los que trabajan en esa tienda (Configuración → Personal por ubicación), más los de
// plataforma, que ven todas.
async function withStoreAccess(manager: EntityManager, userIds: string[], locationId: string): Promise<string[]> {
  if (userIds.length === 0) return [];
  const assigned = await manager.getRepository(UserLocationAccess).find({
    select: { userId: true },
    where: { userId: In(userIds), locationId, status: RecordStatus.ACTIVE },
  });
  const platform = await manager.getRepository(UserCompanyRole).find({
    select: { userId: true },
    where: { userId: In(userIds), status: RecordStatus.ACTIVE, role: PLATFORM_ROLE },
  });
  return [...new Set([...assigned.map((row) => row.userId), ...platform.map((row) => row.userId)])];
}
