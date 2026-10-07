import { formatDocumentNumber } from '../document-sequence/document-number.js';

// Serie del consecutivo de devoluciones, aparte del de ventas (ver DocumentSequenceService).
export const RETURN_SERIES = 'RETURN';

// DEV-00018: consecutivo por empresa, con 5 dígitos como en el diseño.
export function formatReturnNumber(value: number): string {
  return formatDocumentNumber('DEV', value, 5);
}
