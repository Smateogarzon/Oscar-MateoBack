// Serie del consecutivo de pedidos internos, aparte de ventas y devoluciones.
export const INTERNAL_ORDER_SERIES = 'INTERNAL_ORDER';

// 1 -> PED-00001. El número no cambia entre versiones del mismo pedido (ver versionNumber en la
// entidad): una revisión reutiliza el mismo orderNumber y sube de versión.
export function formatInternalOrderNumber(value: number): string {
  return `PED-${value.toString().padStart(5, '0')}`;
}
