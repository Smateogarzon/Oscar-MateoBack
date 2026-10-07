import { formatDocumentNumber } from '../document-sequence/document-number.js';
import { InternalOrderType } from './entities/internal-order-type.enum.js';

// Cada tipo de orden lleva su propio consecutivo: SO-000125 no comparte numeración con RE-000038.
// El número no cambia entre versiones de la misma orden (la versión es aparte: "SO-000125 / v2").
export const INTERNAL_ORDER_SERIES: Record<InternalOrderType, string> = {
  [InternalOrderType.SO]: 'SALES_ORDER',
  [InternalOrderType.RE]: 'RETURN_ORDER',
  [InternalOrderType.TR]: 'TRANSFER_ORDER',
  [InternalOrderType.RS]: 'RESTOCK_ORDER',
};

// (SO, 125) -> SO-000125. En pantalla va con su "#" delante.
export function formatInternalOrderNumber(type: InternalOrderType, value: number): string {
  return formatDocumentNumber(type, value, 6);
}
