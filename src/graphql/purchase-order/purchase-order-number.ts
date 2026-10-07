import { formatDocumentNumber } from '../document-sequence/document-number.js';

// Serie del consecutivo de órdenes de compra, aparte de ventas y devoluciones.
export const PURCHASE_ORDER_SERIES = 'PURCHASE_ORDER';

// 1 -> OC-00001.
export function formatPurchaseOrderNumber(value: number): string {
  return formatDocumentNumber('OC', value, 5);
}
