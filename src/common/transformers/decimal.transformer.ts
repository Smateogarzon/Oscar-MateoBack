import { Decimal } from 'decimal.js';
import type { ValueTransformer } from 'typeorm';

// Las columnas numeric de Postgres llegan como string. Con esto el código trabaja con Decimal
// (sin errores de punto flotante en dinero) y el scalar Decimal de GraphQL, que solo
// serializa instancias de Decimal, puede devolverlas.
export const decimalTransformer: ValueTransformer = {
  to: (value?: Decimal | string | number | null) =>
    value === null || value === undefined ? value : new Decimal(value).toFixed(),
  from: (value?: string | null) =>
    value === null || value === undefined ? value : new Decimal(value),
};
