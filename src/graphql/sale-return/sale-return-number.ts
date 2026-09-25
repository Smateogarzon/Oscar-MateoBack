// Serie del consecutivo de devoluciones, aparte del de ventas (ver DocumentSequenceService).
export const RETURN_SERIES = 'RETURN';

// DEV-00018: consecutivo por empresa, con 5 dígitos como en el diseño. Si algún día pasan de
// 99.999 devoluciones el número simplemente crece (DEV-100000).
export function formatReturnNumber(value: number): string {
  return `DEV-${value.toString().padStart(5, '0')}`;
}
