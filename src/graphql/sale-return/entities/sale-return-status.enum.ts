// PENDING: el cajero la registró y espera aprobación · APPROVED: aprobada, falta entregar el dinero
// o cobrar el cambio · COMPLETED: terminada · REJECTED / CANCELLED: no se hizo.
export enum SaleReturnStatus {
  PENDING = 'PENDING',
  APPROVED = 'APPROVED',
  COMPLETED = 'COMPLETED',
  REJECTED = 'REJECTED',
  CANCELLED = 'CANCELLED',
}

// Las devoluciones que siguen "apartando" lo devuelto de una venta: una rechazada o cancelada lo
// libera para poder devolverlo de nuevo.
export const RESERVING_SALE_RETURN_STATUSES = [
  SaleReturnStatus.PENDING,
  SaleReturnStatus.APPROVED,
  SaleReturnStatus.COMPLETED,
];
