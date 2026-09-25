import { EntityManager, In } from 'typeorm';
import { PermissionCode } from '../../common/enums/permission-code.enum.js';
import { NotificationChannel } from '../notification/entities/notification-channel.enum.js';
import { NotificationEntityType } from '../notification/entities/notification-entity-type.enum.js';
import { NotificationType } from '../notification/entities/notification-type.enum.js';
import type { NotificationService } from '../notification/notification.service.js';
import { DiscountRequestStatus } from './entities/discount-request-status.enum.js';
import { DiscountRequest } from './entities/discount-request.entity.js';

// Cuando una venta se cobra, se cancela o se borra (al cerrar el turno), sus solicitudes de descuento
// dejan de tener a qué aplicarse. Estas funciones las retiran Y avisan a quienes las estaban mirando:
// el aviso de "solicitud nueva" pasa a leído y, en vivo, la lista de pendientes de los administradores
// se pone al día. Sin eso el administrador veía una tarjeta fantasma y al aprobarla recibía "solo se
// puede modificar una venta en borrador". Corren con el manager de la transacción de quien las llama.

// Las solicitudes de esas ventas que estén en alguno de esos estados.
export function findDiscountRequestsOfSales(
  manager: EntityManager,
  saleIds: string[],
  statuses: DiscountRequestStatus[],
): Promise<DiscountRequest[]> {
  if (saleIds.length === 0) return Promise.resolve([]);
  return manager.getRepository(DiscountRequest).find({
    where: { saleId: In(saleIds), status: In(statuses) },
  });
}

// Marca como leídos los avisos de "solicitud nueva" de las pendientes y avisa en vivo a los
// administradores que aprueban descuentos (menos a quien hizo el cambio) que esas solicitudes cambiaron.
export async function clearDiscountRequestNotices(
  manager: EntityManager,
  notifications: NotificationService,
  companyId: string,
  requests: DiscountRequest[],
  actorId: string,
): Promise<void> {
  if (requests.length === 0) return;

  const approverIds = await notifications.findUserIdsWithPermission(
    manager,
    companyId,
    PermissionCode.SALES_APPROVE_DISCOUNT,
  );
  for (const request of requests) {
    if (request.status === DiscountRequestStatus.PENDING) {
      await notifications.markEntityRead(
        manager,
        NotificationEntityType.DISCOUNT_REQUEST,
        request.id,
        [NotificationType.DISCOUNT_REQUESTED],
      );
    }
    notifications.signalChange(manager, {
      companyId,
      channel: NotificationChannel.DISCOUNTS,
      entityType: NotificationEntityType.DISCOUNT_REQUEST,
      entityId: request.id,
      recipientIds: approverIds,
      exceptUserId: actorId,
    });
  }
}

// Cancela las solicitudes de esas ventas que estén en esos estados (dejando la nota) y avisa.
export async function withdrawDiscountRequests(
  manager: EntityManager,
  notifications: NotificationService,
  params: {
    companyId: string;
    saleIds: string[];
    statuses: DiscountRequestStatus[];
    actorId: string;
    note: string;
  },
): Promise<void> {
  const requests = await findDiscountRequestsOfSales(manager, params.saleIds, params.statuses);
  if (requests.length === 0) return;

  await manager.getRepository(DiscountRequest).update(
    { id: In(requests.map((request) => request.id)) },
    {
      status: DiscountRequestStatus.CANCELLED,
      resolvedBy: params.actorId,
      resolvedAt: new Date(),
      resolutionNotes: params.note,
    },
  );
  await clearDiscountRequestNotices(manager, notifications, params.companyId, requests, params.actorId);
}
