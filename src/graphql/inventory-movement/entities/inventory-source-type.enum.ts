// De qué documento salió el movimiento o la reserva (sourceId apunta a él). PURCHASE_ORDER lo usa
// la recepción de una orden de compra (PurchaseOrderReceivingService) y TRANSFER_REQUEST los
// movimientos de un pedido interno (InternalOrderService). RUNNER_ASSIGNMENT queda para cuando haya
// asignación de corredores; nada lo usa todavía.
export enum InventorySourceType {
  SALE = 'SALE',
  SALE_RETURN = 'SALE_RETURN',
  PURCHASE_ORDER = 'PURCHASE_ORDER',
  TRANSFER_REQUEST = 'TRANSFER_REQUEST',
  MANUAL_ADJUSTMENT = 'MANUAL_ADJUSTMENT',
  RUNNER_ASSIGNMENT = 'RUNNER_ASSIGNMENT',
}
