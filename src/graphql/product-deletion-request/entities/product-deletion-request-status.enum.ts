// Ciclo de una solicitud de borrado de referencia. Pendiente es la única ACTIVA: un producto solo
// puede tener una a la vez. Aprobada, rechazada o cancelada dejan pedir otra.
export enum ProductDeletionRequestStatus {
  PENDING = 'PENDING',
  APPROVED = 'APPROVED',
  REJECTED = 'REJECTED',
  CANCELLED = 'CANCELLED',
}

export const ACTIVE_PRODUCT_DELETION_REQUEST_STATUSES = [ProductDeletionRequestStatus.PENDING];
