// El recorrido de un pedido interno, confirmado con el usuario (2026-10-01):
//   PENDING          se pidió
//   ACCEPTED         bodega lo reclamó (warehouseOperatorId, warehouseAcceptedAt)
//   PREPARING        bodega empezó a alistarlo (packingStartedAt)
//   READY            quedó listo para transportar (readyAt); aquí se registra foundQuantity por
//                    línea y, si falta algo, nace una novedad (incidentId)
//   RUNNER_ASSIGNED  un corredor lo tomó por su cuenta de la lista de listos (runnerId,
//                    runnerAcceptedAt) — no hay despachador, el corredor elige
//   IN_TRANSIT       el corredor ya lo tiene encima (runnerPickedUpAt); se mueve existencia del
//                    origen a la bolsa del corredor
//   DELIVERED        el corredor dice que lo entregó (deliveredAt); se mueve existencia de la
//                    bolsa del corredor al destino
//   RECEIVED         el destino confirma que llegó (receivedAt, receivedBy) — paso aparte de
//                    DELIVERED, para que quede registrado quién lo confirma
//   COMPLETED        cerrado
// CANCELLED puede pasar en cualquier punto antes de COMPLETED.
export enum InternalOrderStatus {
  PENDING = 'PENDING',
  ACCEPTED = 'ACCEPTED',
  PREPARING = 'PREPARING',
  READY = 'READY',
  RUNNER_ASSIGNED = 'RUNNER_ASSIGNED',
  IN_TRANSIT = 'IN_TRANSIT',
  DELIVERED = 'DELIVERED',
  RECEIVED = 'RECEIVED',
  COMPLETED = 'COMPLETED',
  CANCELLED = 'CANCELLED',
}
