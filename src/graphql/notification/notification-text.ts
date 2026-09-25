import { NotificationType } from './entities/notification-type.enum.js';

export interface NotificationTextParams {
  actorName: string;
  // El número de la venta o de la devolución. Una venta en borrador todavía no tiene número
  // (se asigna al cobrarla): con null el texto habla de "una venta en curso".
  reference: string | null;
  notes?: string | null;
}

const MESSAGE_MAX_LENGTH = 500;

// "la venta VTA-000123" o, mientras la venta es un borrador sin número, "una venta en curso".
const sale = (p: NotificationTextParams): string =>
  p.reference ? `la venta ${p.reference}` : 'una venta en curso';

// El número de una devolución siempre existe; el respaldo es solo para que el tipo cuadre.
const ref = (p: NotificationTextParams): string => p.reference ?? 'sin número';

const TEXTS: Record<
  NotificationType,
  { title: string; message: (p: NotificationTextParams) => string }
> = {
  [NotificationType.DISCOUNT_REQUESTED]: {
    title: 'Solicitud de descuento',
    message: (p) => `${p.actorName} pidió un descuento en ${sale(p)}.`,
  },
  [NotificationType.DISCOUNT_APPROVED]: {
    title: 'Descuento aprobado',
    message: (p) => `${p.actorName} aprobó el descuento de ${sale(p)}.`,
  },
  [NotificationType.DISCOUNT_REJECTED]: {
    title: 'Descuento rechazado',
    message: (p) => `${p.actorName} rechazó el descuento de ${sale(p)}.`,
  },
  [NotificationType.DISCOUNT_EDITED]: {
    title: 'Descuento modificado',
    message: (p) =>
      `${p.actorName} cambió los montos del descuento de ${sale(p)}.`,
  },
  [NotificationType.DISCOUNT_CANCELLED]: {
    title: 'Descuento cancelado',
    message: (p) =>
      `${p.actorName} canceló la solicitud de descuento de ${sale(p)}.`,
  },
  [NotificationType.RETURN_REQUESTED]: {
    title: 'Solicitud de devolución',
    message: (p) => `${p.actorName} registró la devolución ${ref(p)}.`,
  },
  [NotificationType.RETURN_EDITED]: {
    title: 'Devolución modificada',
    message: (p) => `${p.actorName} modificó la devolución ${ref(p)}.`,
  },
  [NotificationType.RETURN_APPROVED]: {
    title: 'Devolución aprobada',
    message: (p) =>
      `${p.actorName} aprobó la devolución ${ref(p)}. Ya puedes entregar el dinero o cobrar el cambio.`,
  },
  [NotificationType.RETURN_REJECTED]: {
    title: 'Devolución rechazada',
    message: (p) => `${p.actorName} rechazó la devolución ${ref(p)}.`,
  },
  [NotificationType.RETURN_CANCELLED]: {
    title: 'Devolución cancelada',
    message: (p) => `${p.actorName} canceló la devolución ${ref(p)}.`,
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
