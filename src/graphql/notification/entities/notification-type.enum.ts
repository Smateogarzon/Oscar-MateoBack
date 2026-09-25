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
};
