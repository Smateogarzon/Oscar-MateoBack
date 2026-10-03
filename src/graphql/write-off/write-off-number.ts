import { formatDocumentNumber } from '../document-sequence/document-number.js';

// Serie del consecutivo de bajas de inventario, aparte de ventas y devoluciones (ver DocumentSequenceService).
export const WRITE_OFF_SERIES = 'WRITE_OFF';

// 1 -> BAJA-00001.
export function formatWriteOffNumber(value: number): string {
  return formatDocumentNumber('BAJA', value, 5);
}
