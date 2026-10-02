import { Decimal } from 'decimal.js';

export const MONEY_PATTERN = /^\d{1,12}(\.\d{1,2})?$/;

export const QUANTITY_PATTERN = /^\d{1,10}(\.\d{1,2})?$/;

// Un monto que puede ser negativo, como lo contado en el arqueo de un turno.
export const SIGNED_MONEY_PATTERN = /^-?\d{1,12}(\.\d{1,2})?$/;

// numeric(14,2) guarda hasta 999999999999.99 (12 dígitos enteros, 2 decimales): un monto de un
// billón o más no cabe. Mismo tope que valida MONEY_PATTERN, en forma de Decimal para comparar
// valores ya calculados (líneas de venta, costo y precio de una variante, ...).
export const MAX_AMOUNT = new Decimal('1e12');
