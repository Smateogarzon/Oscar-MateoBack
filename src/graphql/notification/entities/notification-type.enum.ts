import { NotificationChannel } from './notification-channel.enum.js';

export enum NotificationType {
  DISCOUNT_REQUESTED = 'DISCOUNT_REQUESTED',
  DISCOUNT_APPROVED = 'DISCOUNT_APPROVED',
  DISCOUNT_REJECTED = 'DISCOUNT_REJECTED',
  DISCOUNT_EDITED = 'DISCOUNT_EDITED',
  DISCOUNT_CANCELLED = 'DISCOUNT_CANCELLED',
  RETURN_REQUESTED = 'RETURN_REQUESTED',
  RETURN_EDITED = 'RETURN_EDITED',
  RETURN_APPROVED = 'RETURN_APPROVED',
  RETURN_REJECTED = 'RETURN_REJECTED',
  RETURN_CANCELLED = 'RETURN_CANCELLED',
  // Una existencia cruzó su mínimo (ver InventoryBalance.minStock): justo al pasar de estar por
  // encima a estar en o por debajo, no en cada movimiento siguiente mientras siga baja (ver
  // InventoryMovementService.maybeNotifyLowStock).
  INVENTORY_LOW_STOCK = 'INVENTORY_LOW_STOCK',
  // Compras (ver purchase-order-watchers.ts): quién recibe cada uno está en esa tabla, no aquí.
  PURCHASE_ORDER_SENT = 'PURCHASE_ORDER_SENT',
  PURCHASE_ORDER_OVERAGE_PENDING = 'PURCHASE_ORDER_OVERAGE_PENDING',
  PURCHASE_ORDER_SHIPPED = 'PURCHASE_ORDER_SHIPPED',
  PURCHASE_ORDER_OVERAGE_APPROVED = 'PURCHASE_ORDER_OVERAGE_APPROVED',
  PURCHASE_ORDER_OVERAGE_REJECTED = 'PURCHASE_ORDER_OVERAGE_REJECTED',
  PURCHASE_ORDER_RECEIVED = 'PURCHASE_ORDER_RECEIVED',
  PURCHASE_ORDER_CANCELLED = 'PURCHASE_ORDER_CANCELLED',
  // Una orden de compra llegó con una incidencia (de despacho o de recepción): va a quien arma las
  // compras, para que la resuelva desde su bandeja (ver PurchaseOrderService.ship / receive).
  PURCHASE_ORDER_INCIDENT = 'PURCHASE_ORDER_INCIDENT',
  // Órdenes internas (Pedidos), canal ORDERS. Cada aviso va a quien tiene que hacer el paso
  // siguiente (ver internal-order-watchers.ts):
  //   ORDER_REQUESTED          bodega: llegó una orden nueva (SO, TR, RS o una sub-orden de cambio)
  //   ORDER_READY_FOR_RUNNER   corredores: hay una orden lista para recoger (o una devolución)
  //   ORDER_DELIVERED          quien la pidió: el corredor la entregó
  //   ORDER_PENDING_PAYMENT    caja de esa tienda: el cliente compra, hay que cobrarla
  //   ORDER_HURRY              bodega: el vendedor apura la orden (cliente esperando)
  //   ORDER_STOCK_QUESTION     bodega: el vendedor pregunta por la existencia
  //   ORDER_RUNNER_CALLED      el corredor asignado: el vendedor pregunta por la orden
  //   ORDER_CORRECTION         corredores y bodega: llegó una referencia equivocada
  ORDER_REQUESTED = 'ORDER_REQUESTED',
  ORDER_READY_FOR_RUNNER = 'ORDER_READY_FOR_RUNNER',
  ORDER_DELIVERED = 'ORDER_DELIVERED',
  ORDER_PENDING_PAYMENT = 'ORDER_PENDING_PAYMENT',
  ORDER_HURRY = 'ORDER_HURRY',
  ORDER_STOCK_QUESTION = 'ORDER_STOCK_QUESTION',
  ORDER_RUNNER_CALLED = 'ORDER_RUNNER_CALLED',
  ORDER_CORRECTION = 'ORDER_CORRECTION',
}

export const CHANNEL_OF_TYPE: Record<NotificationType, NotificationChannel> = {
  [NotificationType.DISCOUNT_REQUESTED]: NotificationChannel.DISCOUNTS,
  [NotificationType.DISCOUNT_APPROVED]: NotificationChannel.DISCOUNTS,
  [NotificationType.DISCOUNT_REJECTED]: NotificationChannel.DISCOUNTS,
  [NotificationType.DISCOUNT_EDITED]: NotificationChannel.DISCOUNTS,
  [NotificationType.DISCOUNT_CANCELLED]: NotificationChannel.DISCOUNTS,
  [NotificationType.RETURN_REQUESTED]: NotificationChannel.RETURNS,
  [NotificationType.RETURN_EDITED]: NotificationChannel.RETURNS,
  [NotificationType.RETURN_APPROVED]: NotificationChannel.RETURNS,
  [NotificationType.RETURN_REJECTED]: NotificationChannel.RETURNS,
  [NotificationType.RETURN_CANCELLED]: NotificationChannel.RETURNS,
  [NotificationType.INVENTORY_LOW_STOCK]: NotificationChannel.INVENTORY,
  [NotificationType.PURCHASE_ORDER_SENT]: NotificationChannel.PURCHASING,
  [NotificationType.PURCHASE_ORDER_OVERAGE_PENDING]: NotificationChannel.PURCHASING,
  [NotificationType.PURCHASE_ORDER_SHIPPED]: NotificationChannel.PURCHASING,
  [NotificationType.PURCHASE_ORDER_OVERAGE_APPROVED]: NotificationChannel.PURCHASING,
  [NotificationType.PURCHASE_ORDER_OVERAGE_REJECTED]: NotificationChannel.PURCHASING,
  [NotificationType.PURCHASE_ORDER_RECEIVED]: NotificationChannel.PURCHASING,
  [NotificationType.PURCHASE_ORDER_CANCELLED]: NotificationChannel.PURCHASING,
  [NotificationType.PURCHASE_ORDER_INCIDENT]: NotificationChannel.PURCHASING,
  [NotificationType.ORDER_REQUESTED]: NotificationChannel.ORDERS,
  [NotificationType.ORDER_READY_FOR_RUNNER]: NotificationChannel.ORDERS,
  [NotificationType.ORDER_DELIVERED]: NotificationChannel.ORDERS,
  [NotificationType.ORDER_PENDING_PAYMENT]: NotificationChannel.ORDERS,
  [NotificationType.ORDER_HURRY]: NotificationChannel.ORDERS,
  [NotificationType.ORDER_STOCK_QUESTION]: NotificationChannel.ORDERS,
  [NotificationType.ORDER_RUNNER_CALLED]: NotificationChannel.ORDERS,
  [NotificationType.ORDER_CORRECTION]: NotificationChannel.ORDERS,
};
