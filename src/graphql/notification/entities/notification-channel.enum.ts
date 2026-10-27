export enum NotificationChannel {
  DISCOUNTS = 'DISCOUNTS',
  RETURNS = 'RETURNS',
  // Solo señales en vivo (no crea avisos): un turno de caja se abrió o se cerró
  CASH = 'CASH',
  // Solicitudes de borrado de una referencia de inventario
  INVENTORY = 'INVENTORY',
  PURCHASING = 'PURCHASING',
  // Un pedido interno cambió de paso (lo pidieron, bodega lo tomó, un corredor lo recogió…): solo
  // señales en vivo, para que el tablero de pedidos de bodega, corredores y tiendas se ponga al día
  // sin recargar. No crea avisos.
  ORDERS = 'ORDERS',
}
