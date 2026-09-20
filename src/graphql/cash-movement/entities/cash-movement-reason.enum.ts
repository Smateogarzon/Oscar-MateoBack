// Por qué se mueve efectivo fuera de una venta. MANUAL_INCOME solo entra a la caja; EXPENSE,
// WITHDRAWAL y REFUND solo la sacan; DEPOSIT, ADJUSTMENT y OTHER pueden ir en cualquier sentido
// (ver CashMovementService).
export enum CashMovementReason {
  MANUAL_INCOME = 'MANUAL_INCOME',
  EXPENSE = 'EXPENSE',
  WITHDRAWAL = 'WITHDRAWAL',
  DEPOSIT = 'DEPOSIT',
  REFUND = 'REFUND',
  ADJUSTMENT = 'ADJUSTMENT',
  OTHER = 'OTHER',
}
