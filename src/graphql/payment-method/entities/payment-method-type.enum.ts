// CASH entra a la caja física y cuenta para el cierre del turno; CARD y TRANSFER no pasan por
// la caja.
export enum PaymentMethodType {
  CASH = 'CASH',
  CARD = 'CARD',
  TRANSFER = 'TRANSFER',
}
