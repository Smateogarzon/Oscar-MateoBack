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
};
