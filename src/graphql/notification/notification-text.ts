import { NotificationType } from './entities/notification-type.enum.js';

export interface NotificationTextParams {
  actorName: string;
  reference: string;
  notes?: string | null;
}

const MESSAGE_MAX_LENGTH = 500;

const TEXTS: Record<
  NotificationType,
  { title: string; message: (p: NotificationTextParams) => string }
> = {
  [NotificationType.DISCOUNT_REQUESTED]: {
    title: 'Solicitud de descuento',
    message: (p) =>
      `${p.actorName} pidió un descuento en la venta ${p.reference}.`,
  },
  [NotificationType.DISCOUNT_APPROVED]: {
    title: 'Descuento aprobado',
    message: (p) =>
      `${p.actorName} aprobó el descuento de la venta ${p.reference}.`,
  },
  [NotificationType.DISCOUNT_REJECTED]: {
    title: 'Descuento rechazado',
    message: (p) =>
      `${p.actorName} rechazó el descuento de la venta ${p.reference}.`,
  },
  [NotificationType.DISCOUNT_EDITED]: {
    title: 'Descuento modificado',
    message: (p) =>
      `${p.actorName} cambió los montos del descuento de la venta ${p.reference}.`,
  },
  [NotificationType.DISCOUNT_CANCELLED]: {
    title: 'Descuento cancelado',
    message: (p) =>
      `${p.actorName} canceló la solicitud de descuento de la venta ${p.reference}.`,
  },
  [NotificationType.RETURN_REQUESTED]: {
    title: 'Solicitud de devolución',
    message: (p) => `${p.actorName} registró la devolución ${p.reference}.`,
  },
  [NotificationType.RETURN_EDITED]: {
    title: 'Devolución modificada',
    message: (p) => `${p.actorName} modificó la devolución ${p.reference}.`,
  },
  [NotificationType.RETURN_APPROVED]: {
    title: 'Devolución aprobada',
    message: (p) =>
      `${p.actorName} aprobó la devolución ${p.reference}. Ya puedes entregar el dinero o cobrar el cambio.`,
  },
  [NotificationType.RETURN_REJECTED]: {
    title: 'Devolución rechazada',
    message: (p) => `${p.actorName} rechazó la devolución ${p.reference}.`,
  },
  [NotificationType.RETURN_CANCELLED]: {
    title: 'Devolución cancelada',
    message: (p) => `${p.actorName} canceló la devolución ${p.reference}.`,
  },
};

const TYPES_WITH_NOTES = new Set<NotificationType>([
  NotificationType.DISCOUNT_REJECTED,
  NotificationType.DISCOUNT_CANCELLED,
  NotificationType.RETURN_REJECTED,
  NotificationType.RETURN_CANCELLED,
]);

export function buildNotificationText(
  type: NotificationType,
  params: NotificationTextParams,
): { title: string; message: string } {
  const { title, message } = TEXTS[type];
  const notes = params.notes?.trim();
  const full =
    notes && TYPES_WITH_NOTES.has(type)
      ? `${message(params)} Nota: ${notes}`
      : message(params);
  return { title, message: full.slice(0, MESSAGE_MAX_LENGTH) };
}
