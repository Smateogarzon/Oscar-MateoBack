import { NotificationType } from './entities/notification-type.enum.js';

export interface NotificationTextParams {
  actorName: string;
  // El número de la venta o de la devolución. Una venta en borrador todavía no tiene número
  // (se asigna al cobrarla): con null el texto habla de "una venta en curso". En
  // INVENTORY_LOW_STOCK lleva el producto y el SKU en vez de un número (ver `productRef`).
  reference: string | null;
  notes?: string | null;
  // Solo para INVENTORY_LOW_STOCK (ver InventoryMovementService.maybeNotifyLowStock).
  quantity?: string;
  minStock?: string;
  locationName?: string | null;
  outOfStock?: boolean;
}

const MESSAGE_MAX_LENGTH = 500;

// "la venta VTA-000123" o, mientras la venta es un borrador sin número, "una venta en curso".
const sale = (p: NotificationTextParams): string =>
  p.reference ? `la venta ${p.reference}` : 'una venta en curso';

// El número de una devolución siempre existe; el respaldo es solo para que el tipo cuadre.
const ref = (p: NotificationTextParams): string => p.reference ?? 'sin número';

// La referencia del producto siempre existe (se genera sola al crearlo); el respaldo es solo para
// que el tipo cuadre.
const productRef = (p: NotificationTextParams): string => (p.reference ? `la referencia ${p.reference}` : 'una referencia');

// El número de una orden de compra (OC-000123). Sin montos a propósito: el mismo texto lo ven el
// proveedor y la empresa, y no todos deben ver cuánto vale la compra.
const order = (p: NotificationTextParams): string => `la orden de compra ${ref(p)}`;

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
  [NotificationType.INVENTORY_LOW_STOCK]: {
    title: 'Existencia baja',
    message: (p) => {
      const where = p.locationName ? ` en ${p.locationName}` : '';
      const left = p.quantity ?? '0';
      return p.outOfStock
        ? `${productRef(p)} se agotó${where}: quedaron ${left} unidades.`
        : `${productRef(p)} está baja${where}: quedaron ${left} unidades (mínimo ${p.minStock ?? '-'}).`;
    },
  },
  [NotificationType.PURCHASE_ORDER_SENT]: {
    title: 'Orden de compra enviada',
    message: (p) => `${p.actorName} envió ${order(p)}.`,
  },
  [NotificationType.PURCHASE_ORDER_OVERAGE_PENDING]: {
    title: 'Sobrante por autorizar',
    message: (p) => `${p.actorName} despachó ${order(p)} con más de lo pedido. Hay que autorizar el sobrante.`,
  },
  [NotificationType.PURCHASE_ORDER_SHIPPED]: {
    title: 'Orden despachada',
    message: (p) => `${p.actorName} despachó ${order(p)}.`,
  },
  [NotificationType.PURCHASE_ORDER_OVERAGE_APPROVED]: {
    title: 'Sobrante autorizado',
    message: (p) => `${p.actorName} autorizó el sobrante de ${order(p)}.`,
  },
  [NotificationType.PURCHASE_ORDER_OVERAGE_REJECTED]: {
    title: 'Sobrante rechazado',
    message: (p) => `${p.actorName} rechazó el sobrante de ${order(p)}. Hay que volver a contar el envío.`,
  },
  [NotificationType.PURCHASE_ORDER_RECEIVED]: {
    title: 'Orden recibida en bodega',
    message: (p) => `${p.actorName} recibió en bodega ${order(p)}.`,
  },
  [NotificationType.PURCHASE_ORDER_CANCELLED]: {
    title: 'Orden de compra cancelada',
    message: (p) => `${p.actorName} canceló ${order(p)}.`,
  },
};

const TYPES_WITH_NOTES = new Set<NotificationType>([
  NotificationType.DISCOUNT_REJECTED,
  NotificationType.DISCOUNT_CANCELLED,
  NotificationType.RETURN_REJECTED,
  NotificationType.RETURN_CANCELLED,
  NotificationType.PURCHASE_ORDER_CANCELLED,
  NotificationType.PURCHASE_ORDER_OVERAGE_REJECTED,
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
