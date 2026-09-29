import { Decimal } from 'decimal.js';
import { MAX_AMOUNT } from '../../common/utils/money.js';

// Toda la aritmética de dinero de una venta, con Decimal y sin punto flotante. Se redondea a
// centavos "mitad hacia arriba" y de forma explícita, sin depender de la configuración global.
const CENTS = 2;

// Reexportado desde common/utils/money.ts (ahí vive el valor): así el resto del módulo de ventas
// sigue importándolo de aquí, sin tocar cada archivo que ya lo usaba.
export { MAX_AMOUNT };

// Valor de una línea: cantidad × precio unitario (redondeado a centavos) y ese valor menos el
// descuento de la línea.
export function calculateLine(quantity: Decimal, unitPrice: Decimal, discountAmount: Decimal) {
  const gross = quantity.times(unitPrice).toDecimalPlaces(CENTS, Decimal.ROUND_HALF_UP);
  return { gross, total: gross.minus(discountAmount) };
}

interface LineAmounts {
  total: Decimal;
  discountAmount: Decimal;
}

// Totales de la venta a partir de sus líneas y de su descuento general:
//   subtotal      = valor de las líneas antes de descuentos (Σ total + Σ descuento de línea)
//   discountTotal = descuentos de las líneas + descuento general
//   total         = subtotal − discountTotal
// `net` es lo que suman las líneas ya con su descuento: el descuento general no puede pasarse.
export function calculateSaleTotals(lines: LineAmounts[], generalDiscount: Decimal) {
  const net = lines.reduce((sum, line) => sum.plus(line.total), new Decimal(0));
  const lineDiscounts = lines.reduce((sum, line) => sum.plus(line.discountAmount), new Decimal(0));

  return {
    net,
    subtotal: net.plus(lineDiscounts),
    discountTotal: lineDiscounts.plus(generalDiscount),
    total: net.minus(generalDiscount),
  };
}
