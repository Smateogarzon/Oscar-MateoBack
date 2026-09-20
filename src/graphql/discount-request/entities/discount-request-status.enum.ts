// Ciclo de una solicitud de descuento. Pendiente y aprobada son las ACTIVAS: una venta solo
// puede tener una. Rechazada o cancelada ya no ocupan ese lugar y dejan pedir otra.
export enum DiscountRequestStatus {
  PENDING = 'PENDING',
  APPROVED = 'APPROVED',
  REJECTED = 'REJECTED',
  CANCELLED = 'CANCELLED',
}

export const ACTIVE_DISCOUNT_REQUEST_STATUSES = [
  DiscountRequestStatus.PENDING,
  DiscountRequestStatus.APPROVED,
];
