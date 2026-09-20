import { Decimal } from 'decimal.js';
import { CashMovementType } from '../cash-movement/entities/cash-movement-type.enum.js';
import { PaymentMethodType } from '../payment-method/entities/payment-method-type.enum.js';

// La aritmética de un turno, con Decimal y sin punto flotante. Solo lo cobrado en EFECTIVO entra a
// la caja: tarjeta y transferencia se suman aparte porque el dinero no pasa por el cajón.
//   efectivo esperado = apertura + ventas en efectivo + ingresos − egresos
export function calculateSessionTotals(
  openingAmount: Decimal,
  payments: { amount: Decimal; type: PaymentMethodType }[],
  movements: { amount: Decimal; type: CashMovementType }[],
) {
  const sum = (amounts: Decimal[]) =>
    amounts.reduce((total, amount) => total.plus(amount), new Decimal(0));
  const paidWith = (type: PaymentMethodType) =>
    sum(payments.filter((payment) => payment.type === type).map((payment) => payment.amount));
  const moved = (type: CashMovementType) =>
    sum(movements.filter((movement) => movement.type === type).map((movement) => movement.amount));

  const cashSales = paidWith(PaymentMethodType.CASH);
  const cashIn = moved(CashMovementType.CASH_IN);
  const cashOut = moved(CashMovementType.CASH_OUT);

  return {
    cashSales,
    cardSales: paidWith(PaymentMethodType.CARD),
    transferSales: paidWith(PaymentMethodType.TRANSFER),
    cashIn,
    cashOut,
    expectedCash: openingAmount.plus(cashSales).plus(cashIn).minus(cashOut),
  };
}
