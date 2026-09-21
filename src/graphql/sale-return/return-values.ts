import { Decimal } from 'decimal.js';

// Cuánto vale devolver algo: lo que el cliente REALMENTE pagó, con los descuentos que tuvo. Todo
// con Decimal, redondeando a centavos "mitad hacia arriba", y de forma que devolver todas las
// unidades de una venta devuelva exactamente lo que se pagó, sin centavos de más ni de menos.

export interface ReturnableLine {
  id: string;
  quantity: Decimal;
  // Lo que valió la línea con su propio descuento: cantidad × precio − descuento de la línea
  total: Decimal;
}

// Lo que el cliente pagó por cada línea. El descuento general de la venta se reparte entre las
// líneas en proporción a lo que valió cada una; la última se lleva lo que quede, para que todo sume
// exactamente el total de la venta. Las líneas se reciben siempre en el mismo orden (por fecha de
// creación) para que el reparto sea el mismo en cada devolución.
export function paidPerLine(
  lines: ReturnableLine[],
  generalDiscount: Decimal,
): Map<string, Decimal> {
  const paid = new Map<string, Decimal>();
  const net = lines.reduce((sum, line) => sum.plus(line.total), new Decimal(0));

  if (generalDiscount.isZero() || net.isZero()) {
    for (const line of lines) paid.set(line.id, line.total);
    return paid;
  }

  let allocated = new Decimal(0);
  lines.forEach((line, index) => {
    const isLast = index === lines.length - 1;
    const share = isLast
      ? generalDiscount.minus(allocated)
      : line.total
          .times(generalDiscount)
          .dividedBy(net)
          .toDecimalPlaces(2, Decimal.ROUND_HALF_UP);
    allocated = allocated.plus(share);
    paid.set(line.id, line.total.minus(share));
  });
  return paid;
}

// Lo que vale devolver `quantityToReturn` unidades de una línea que el cliente pagó con `paid` por
// `quantity` unidades, de las que ya se devolvieron `returnedQuantity` por `returnedAmount`. Si con
// esta devolución se devuelve todo lo que quedaba, vale exactamente lo que quedaba por devolver.
export function returnValue(
  paid: Decimal,
  quantity: Decimal,
  returnedQuantity: Decimal,
  returnedAmount: Decimal,
  quantityToReturn: Decimal,
): Decimal {
  const remainingQuantity = quantity.minus(returnedQuantity);
  if (quantityToReturn.equals(remainingQuantity)) return paid.minus(returnedAmount);

  return paid.times(quantityToReturn).dividedBy(quantity).toDecimalPlaces(2, Decimal.ROUND_HALF_UP);
}
