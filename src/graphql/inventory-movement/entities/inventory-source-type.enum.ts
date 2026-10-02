// De qué documento salió el movimiento o la reserva (sourceId apunta a él). Todavía no hay
// pedidos internos ni corredores (fase siguiente): PURCHASE_ORDER, TRANSFER_REQUEST y
// RUNNER_ASSIGNMENT están aquí para cuando existan, pero nada los usa todavía.
export enum InventorySourceType {
  SALE = 'SALE',
  SALE_RETURN = 'SALE_RETURN',
  PURCHASE_ORDER = 'PURCHASE_ORDER',
  TRANSFER_REQUEST = 'TRANSFER_REQUEST',
  MANUAL_ADJUSTMENT = 'MANUAL_ADJUSTMENT',
  RUNNER_ASSIGNMENT = 'RUNNER_ASSIGNMENT',
}
