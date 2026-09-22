// Por qué se mueve efectivo fuera de una venta. EXPENSE, WITHDRAWAL y REFUND solo la sacan;
// DEPOSIT puede ir en cualquier sentido (ver CashMovementService).
export enum CashMovementReason {
  EXPENSE = 'EXPENSE',
  WITHDRAWAL = 'WITHDRAWAL',
  DEPOSIT = 'DEPOSIT',
  REFUND = 'REFUND',
}
