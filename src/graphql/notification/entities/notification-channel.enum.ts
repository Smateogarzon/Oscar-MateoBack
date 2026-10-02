export enum NotificationChannel {
  DISCOUNTS = 'DISCOUNTS',
  RETURNS = 'RETURNS',
  // Solo señales en vivo (no crea avisos): un turno de caja se abrió o se cerró
  CASH = 'CASH',
  // Solicitudes de borrado de una referencia de inventario
  INVENTORY = 'INVENTORY',
}
