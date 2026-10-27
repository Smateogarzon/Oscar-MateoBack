import { formatDocumentNumber } from '../document-sequence/document-number.js';

// Serie de numeración de las ventas en DocumentSequence: un consecutivo por empresa.
export const SALE_SERIES = 'SALE';

// 1 -> VTA-000001.
export const formatSaleNumber = (value: number): string => formatDocumentNumber('VTA', value, 6);
