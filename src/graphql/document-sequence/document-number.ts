// El número visible de un documento a partir de su consecutivo (DocumentSequenceService): el prefijo
// de la serie y el número con ceros a la izquierda hasta `width` dígitos. Si algún día el consecutivo
// pasa de ese ancho, el número simplemente crece (VTA-1000000). Cada módulo define su serie y su
// prefijo en su `*-number.ts`; el formato es uno solo.
export function formatDocumentNumber(prefix: string, value: number, width: number): string {
  return `${prefix}-${String(value).padStart(width, '0')}`;
}
