// Todos los estados de las órdenes internas, de los cuatro tipos. Qué estado sigue a cuál depende
// del tipo, y está en una sola tabla: internal-order-flow.ts.
//
// SO  NEW → PACKING → READY_FOR_RUNNER → IN_TRANSIT → DELIVERED_TO_STORE →
//     RECEIVED_BY_SELLER → (PENDING_PAYMENT → PAID | RETURN_REQUESTED → RETURNED |
//     ITEM_CHANGE_REQUESTED → CLOSED_BY_CHANGE). En un cambio de pedido la original termina en
//     CLOSED_BY_CHANGE (terminada, sin cobro) y es la sub-orden la que sigue hasta el pago.
// RE  RETURN_CREATED → WAITING_FOR_RUNNER → IN_TRANSIT_TO_WAREHOUSE → DELIVERED_TO_WAREHOUSE →
//     RETURNED (bodega recibe, cuenta y cierra en un solo paso; RECEIVED_BY_WAREHOUSE quedó para
//     las devoluciones que se recibieron cuando eran dos)
// TR  TRANSFER_REQUESTED → WAITING_FOR_RUNNER → IN_TRANSIT → DELIVERED_TO_DESTINATION →
//     RECEIVED_BY_DESTINATION → TRANSFERRED
// RS  RESTOCK_REQUESTED → WAITING_FOR_RUNNER → IN_TRANSIT → DELIVERED_TO_STORE → RECEIVED_BY_STORE →
//     RESTOCKED
// CANCELLED: cualquiera, antes de que el corredor recoja.
export enum InternalOrderStatus {
  NEW = 'NEW',
  // Heredado: el flujo ya no pasa por aquí (de NEW se va directo a PACKING); queda para las órdenes
  // que se aceptaron antes y para su bitácora.
  ACCEPTED_BY_WAREHOUSE = 'ACCEPTED_BY_WAREHOUSE',
  PACKING = 'PACKING',
  READY_FOR_RUNNER = 'READY_FOR_RUNNER',
  IN_TRANSIT = 'IN_TRANSIT',
  DELIVERED_TO_STORE = 'DELIVERED_TO_STORE',
  RECEIVED_BY_SELLER = 'RECEIVED_BY_SELLER',
  PENDING_PAYMENT = 'PENDING_PAYMENT',
  PAID = 'PAID',
  RETURN_REQUESTED = 'RETURN_REQUESTED',
  ITEM_CHANGE_REQUESTED = 'ITEM_CHANGE_REQUESTED',
  // Heredado: así terminaba la sub-orden cuando era ella la que se fundía en la original. Ahora pasa
  // al revés (la original termina en CLOSED_BY_CHANGE); queda para las órdenes que ya cerraron así.
  MERGED_INTO_PARENT = 'MERGED_INTO_PARENT',
  // La orden original de un cambio de pedido: terminada sin cobro, porque lo que el cliente se lleva
  // (lo que se quedó más lo nuevo) se cobra en la sub-orden del cambio.
  CLOSED_BY_CHANGE = 'CLOSED_BY_CHANGE',
  RETURN_CREATED = 'RETURN_CREATED',
  WAITING_FOR_RUNNER = 'WAITING_FOR_RUNNER',
  IN_TRANSIT_TO_WAREHOUSE = 'IN_TRANSIT_TO_WAREHOUSE',
  DELIVERED_TO_WAREHOUSE = 'DELIVERED_TO_WAREHOUSE',
  RECEIVED_BY_WAREHOUSE = 'RECEIVED_BY_WAREHOUSE',
  RETURNED = 'RETURNED',
  TRANSFER_REQUESTED = 'TRANSFER_REQUESTED',
  DELIVERED_TO_DESTINATION = 'DELIVERED_TO_DESTINATION',
  RECEIVED_BY_DESTINATION = 'RECEIVED_BY_DESTINATION',
  TRANSFERRED = 'TRANSFERRED',
  RESTOCK_REQUESTED = 'RESTOCK_REQUESTED',
  RECEIVED_BY_STORE = 'RECEIVED_BY_STORE',
  RESTOCKED = 'RESTOCKED',
  CANCELLED = 'CANCELLED',
}
