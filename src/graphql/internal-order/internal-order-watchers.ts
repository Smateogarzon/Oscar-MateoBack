import { In, type EntityManager } from 'typeorm';
import { IncidentStatus } from '../incident/entities/incident-status.enum.js';
import { Incident } from '../incident/entities/incident.entity.js';
import { usersWithStoreAccess } from '../../common/access/store-access.js';
import { PermissionCode } from '../../common/enums/permission-code.enum.js';
import { Location } from '../location/entities/location.entity.js';
import { NotificationChannel } from '../notification/entities/notification-channel.enum.js';
import { NotificationEntityType } from '../notification/entities/notification-entity-type.enum.js';
import { NotificationType } from '../notification/entities/notification-type.enum.js';
import type { NotificationService } from '../notification/notification.service.js';
import { InternalOrderStatus as S } from './entities/internal-order-status.enum.js';
import type { InternalOrder } from './entities/internal-order.entity.js';
import { ORDER_INCIDENT_ENTITY, ORDER_ITEM_INCIDENT_ENTITY } from './internal-order-entities.js';
import { PICKED_UP_STATUSES, RUNNER_ENGAGED_STATUSES, WAITING_RUNNER_STATUSES } from './internal-order-flow.js';

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

// Nadie ha tocado la orden todavía: sigue esperando que bodega la tome.
const UNTOUCHED_STATUSES: readonly S[] = [
  S.NEW,
  S.ACCEPTED_BY_WAREHOUSE,
  S.TRANSFER_REQUESTED,
  S.RESTOCK_REQUESTED,
  S.RETURN_CREATED,
];

// El corredor la entregó y falta que el destino confirme el recibo.
const AWAITING_RECEIPT_STATUSES: readonly S[] = [S.DELIVERED_TO_STORE, S.DELIVERED_TO_WAREHOUSE, S.DELIVERED_TO_DESTINATION];

// La mercancía todavía no ha salido del origen: es la misma ventana en la que se puede apurar la
// orden o preguntarle a bodega (ver `InternalOrderService.nudge`), así que es hasta donde esos avisos
// le piden algo a alguien. Una orden anulada no cuenta: ahí ya no hay nada que apurar.
const BEFORE_PICKUP_STATUSES: readonly S[] = Object.values(S).filter(
  (status) => !PICKED_UP_STATUSES.includes(status) && status !== S.CANCELLED,
);

// Hasta cuándo un aviso de una orden le sigue pidiendo algo a alguien.
//
// El problema que resuelve: cada aviso va a TODOS los que pueden dar el paso (toda la bodega, todos
// los corredores, toda la caja de la tienda), pero solo salía de "Pendientes" para quien lo abría. En
// cuanto uno daba el paso, a los demás les quedaba ahí para siempre: la orden ya estaba alistada,
// cobrada o anulada y su bandeja seguía pidiéndoselo.
//
// Al cambiar el estado de la orden, los avisos que ya no están vivos se marcan leídos —pasan a
// "Resueltas"— para todos los que no los abrieron (ver `settleInternalOrderNotices`). Los que sí los
// abrieron conservan su rastro: marcar leído no cambia la fecha de quien ya lo leyó.
//
// Lo que no está en esta tabla no se liquida con el estado:
//   ORDER_CANCELLED   nace con la orden ya anulada y justamente pide lo único que queda por hacer
//                     (devolver a su sitio lo que bodega había separado): espera a que se abra.
//   ORDER_CORRECTION  lo cierra su propia corrección, no el estado de la orden (que no cambia
//                     mientras el retorno por error va y viene): ver `settleCorrectionNotices`.
const NOTICE_ALIVE_WHILE: ReadonlyArray<readonly [NotificationType, readonly S[]]> = [
  // bodega: llegó una orden nueva · deja de pedir algo en cuanto bodega la toma
  [NotificationType.ORDER_REQUESTED, UNTOUCHED_STATUSES],
  // corredores: hay una lista para recoger · hasta que un corredor la recoge
  [NotificationType.ORDER_READY_FOR_RUNNER, WAITING_RUNNER_STATUSES],
  // quien la pidió: el corredor la entregó · hasta que confirma el recibo
  [NotificationType.ORDER_DELIVERED, AWAITING_RECEIPT_STATUSES],
  // caja de la tienda: hay que cobrarla · hasta que se cobra o vuelve al vendedor
  [NotificationType.ORDER_PENDING_PAYMENT, [S.PENDING_PAYMENT]],
  // bodega: el vendedor apura o pregunta · hasta que la mercancía sale del origen
  [NotificationType.ORDER_HURRY, BEFORE_PICKUP_STATUSES],
  [NotificationType.ORDER_STOCK_QUESTION, BEFORE_PICKUP_STATUSES],
  // el corredor y quien la pidió · mientras el corredor responda por la orden
  [NotificationType.ORDER_RUNNER_CALLED, RUNNER_ENGAGED_STATUSES],
  [NotificationType.ORDER_RUNNER_REPLIED, RUNNER_ENGAGED_STATUSES],
];

// Liquida los avisos de la orden que su estado dejó sin nada que pedir (ver `NOTICE_ALIVE_WHILE`).
// Lo llama `InternalOrderService.setStatus`, que es por donde pasa todo cambio de estado, dentro de
// la misma transacción: si el paso se deshace, los avisos siguen pendientes.
export async function settleInternalOrderNotices(
  manager: EntityManager,
  notifications: NotificationService,
  internalOrder: InternalOrder,
): Promise<void> {
  const settled = NOTICE_ALIVE_WHILE.filter(([, aliveWhile]) => !aliveWhile.includes(internalOrder.status)).map(([type]) => type);
  // "Hay una lista para recoger" es una oferta a todos los corredores, y deja de serlo en cuanto uno
  // la toma: desde ahí solo él puede recogerla y los demás ni siquiera la ven. Va aparte de la tabla
  // de arriba porque tomarla NO cambia el estado de la orden (sigue esperando corredor).
  if (internalOrder.runnerId && !settled.includes(NotificationType.ORDER_READY_FOR_RUNNER)) {
    settled.push(NotificationType.ORDER_READY_FOR_RUNNER);
  }
  // Lo mismo con "llegó un pedido nuevo": va a toda la bodega y deja de pedirle algo al resto en
  // cuanto un bodeguero lo toma (ver `InternalOrderService.claimForWarehouse`), aunque tomarlo no
  // cambie el estado. Si lo suelta, el aviso ya no vuelve a pendientes: queda en su bandeja como
  // leído y el pedido sin tomar se ve igual en la vista de bodega.
  if (internalOrder.warehouseOperatorId && !settled.includes(NotificationType.ORDER_REQUESTED)) {
    settled.push(NotificationType.ORDER_REQUESTED);
  }
  if (settled.length === 0) return;
  await notifications.markEntityRead(manager, NotificationEntityType.INTERNAL_ORDER, internalOrder.id, settled);
}

// El aviso de "novedad en un pedido" sigue pendiente mientras a la orden le quede alguna novedad
// abierta (de la orden o de cualquiera de sus líneas). Cuando ya no le queda ninguna, se marca como
// leído: sale de pendientes para todos los que no lo abrieron. Lo llama IncidentService cada vez que
// una novedad se resuelve o se cancela, igual que en las compras.
export async function settleOrderIncidentNotices(
  manager: EntityManager,
  notifications: NotificationService,
  internalOrderId: string,
  itemIds: readonly string[],
): Promise<void> {
  const openStatuses = [IncidentStatus.OPEN, IncidentStatus.IN_REVIEW];
  const repo = manager.getRepository(Incident);
  const open = await repo.count({
    where: [
      { entityType: ORDER_INCIDENT_ENTITY, entityId: internalOrderId, status: In(openStatuses) },
      ...(itemIds.length > 0 ? [{ entityType: ORDER_ITEM_INCIDENT_ENTITY, entityId: In([...itemIds]), status: In(openStatuses) }] : []),
    ],
  });
  if (open > 0) return;
  await notifications.markEntityRead(manager, NotificationEntityType.INTERNAL_ORDER, internalOrderId, [NotificationType.ORDER_INCIDENT]);
}

// El retorno por error se cerró (el vendedor recibió la referencia correcta): el aviso que lo pedía
// ya no le pide nada ni a bodega ni a los corredores.
export async function settleCorrectionNotices(
  manager: EntityManager,
  notifications: NotificationService,
  internalOrderId: string,
): Promise<void> {
  await notifications.markEntityRead(manager, NotificationEntityType.INTERNAL_ORDER, internalOrderId, [
    NotificationType.ORDER_CORRECTION,
  ]);
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
    case 'RUNNERS': {
      // Los corredores que pueden tomar ESTA orden: los que trabajan en la sede de donde sale o a la
      // que llega (Configuración → Personal por ubicación), que es la misma regla con la que la ven
      // (ver internal-order-visibility.ts). A los demás el aviso solo les llegaba para nada: ni
      // siquiera pueden abrir la orden.
      const runners = await notifications.findUserIdsWithPermission(manager, companyId, PermissionCode.RUNNER_PICKUP_ORDERS);
      return usersWithStoreAccess(manager, runners, [order.sourceLocationId, order.destinationLocationId]);
    }
    case 'RUNNER':
      return order.runnerId ? [order.runnerId] : [];
    case 'REQUESTER':
      return order.requestedBy ? [order.requestedBy] : [];
    case 'STORE_CASHIERS': {
      const charge = await notifications.findUserIdsWithPermission(manager, companyId, PermissionCode.CASH_CHARGE_ORDERS);
      const pay = await notifications.findUserIdsWithPermission(manager, companyId, PermissionCode.CASH_REGISTER_PAYMENT);
      return usersWithStoreAccess(manager, [...new Set([...charge, ...pay])], order.destinationLocationId);
    }
  }
}

