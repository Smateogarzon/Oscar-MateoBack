// Serie del consecutivo de bajas de inventario, aparte de ventas y devoluciones (ver DocumentSequenceService).
export const WRITE_OFF_SERIES = 'WRITE_OFF';

// 1 -> BAJA-00001.
export function formatWriteOffNumber(value: number): string {
  return `BAJA-${value.toString().padStart(5, '0')}`;
}
