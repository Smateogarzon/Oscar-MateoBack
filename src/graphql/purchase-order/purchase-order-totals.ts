import { Decimal } from 'decimal.js';
import { BadRequestException } from '@nestjs/common';
import { MAX_AMOUNT, roundMoney } from '../../common/utils/money.js';

export interface PricedLine {
  quantity: Decimal;
  unitCost: Decimal;
}

// El subtotal de una orden es la suma de cantidad × costo de cada línea, cada una a centavos como
// las líneas de una venta (roundMoney); no hay impuestos ni descuentos en la orden de compra, así
// que el total es igual al subtotal. numeric(14,2) no admite
// un monto de un billón o más: se rechaza antes de que lo haga la base de datos.
export function purchaseOrderTotals(lines: readonly PricedLine[]): { subtotal: Decimal; total: Decimal } {
  const subtotal = lines.reduce((sum, line) => sum.plus(roundMoney(line.quantity.times(line.unitCost))), new Decimal(0));
  if (subtotal.greaterThanOrEqualTo(MAX_AMOUNT)) {
    throw new BadRequestException('El total de la orden de compra es demasiado grande');
  }
  return { subtotal, total: subtotal };
}
