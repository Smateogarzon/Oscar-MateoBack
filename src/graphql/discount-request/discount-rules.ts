import { Decimal } from 'decimal.js';

// Tope de un descuento: el 30 % del valor de aquello sobre lo que se pide, ya sea una línea o
// toda la venta. Vale para quien lo pide, para quien lo aprueba y para quien lo edita: ni un
// administrador pasa de ahí.
export const MAX_DISCOUNT_PERCENT = 30;

// Lo máximo que se puede descontar sobre algo que vale `value`, en centavos y redondeando "mitad
// hacia arriba". Al redondear igual que se convierte un porcentaje en monto, cualquier
// porcentaje hasta el tope da un monto que cabe.
export function maxDiscountFor(value: Decimal): Decimal {
  return value
    .times(MAX_DISCOUNT_PERCENT)
    .dividedBy(100)
    .toDecimalPlaces(2, Decimal.ROUND_HALF_UP);
}

// Lo que vale una línea antes de su descuento: su total más el descuento que ya lleve.
export function lineGross(line: { total: Decimal; discountAmount: Decimal }): Decimal {
  return line.total.plus(line.discountAmount);
}
