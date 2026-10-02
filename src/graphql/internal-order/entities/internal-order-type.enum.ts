// Para qué es el pedido. Todos viajan por el mismo flujo bodega→corredor→destino; solo
// CUSTOMER_REQUEST trae precio en sus líneas (lo que el cliente paga), los demás no.
export enum InternalOrderType {
  CUSTOMER_REQUEST = 'CUSTOMER_REQUEST',
  REPLENISHMENT = 'REPLENISHMENT',
  TRANSFER = 'TRANSFER',
  RETURN = 'RETURN',
  EXCHANGE = 'EXCHANGE',
}
