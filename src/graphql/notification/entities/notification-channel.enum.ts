export enum NotificationChannel {
  DISCOUNTS = 'DISCOUNTS',
  RETURNS = 'RETURNS',
  // Solo señales en vivo (no crea avisos): un turno de caja se abrió o se cerró
  CASH = 'CASH',
  // Solicitudes de borrado de una referencia de inventario
  INVENTORY = 'INVENTORY',
  // Una orden de compra se armó, se envió, se despachó, quedó esperando que se autorice un sobrante,
  // se recibió o se canceló: esas son solo señales en vivo (la orden va y viene entre la empresa y su
  // proveedor, así que lo que hace uno tiene que verse en la pantalla del otro sin recargar). Llegar
  // con una incidencia sí deja un aviso en la bandeja de quien arma las compras.
  PURCHASING = 'PURCHASING',
  // Un pedido interno cambió de paso (lo pidieron, bodega lo tomó, un corredor lo recogió…): solo
  // señales en vivo, para que el tablero de pedidos de bodega, corredores y tiendas se ponga al día
  // sin recargar. No crea avisos.
  ORDERS = 'ORDERS',
}
