export enum NotificationChannel {
  DISCOUNTS = 'DISCOUNTS',
  RETURNS = 'RETURNS',
  // Solo señales en vivo (no crea avisos): un turno de caja se abrió o se cerró
  CASH = 'CASH',
  // Solicitudes de borrado de una referencia de inventario
  INVENTORY = 'INVENTORY',
  // Solo señales en vivo (no crea avisos): una orden de compra se armó, se envió, se despachó, quedó
  // esperando que se autorice un sobrante, se recibió o se canceló. La orden va y viene entre la empresa y su proveedor, así que lo que hace
  // uno tiene que verse en la pantalla del otro sin recargar.
  PURCHASING = 'PURCHASING',
}
