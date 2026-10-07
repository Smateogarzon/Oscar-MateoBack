import { PermissionCode } from '../../common/enums/permission-code.enum.js';
import { InternalOrderStatus as S } from './entities/internal-order-status.enum.js';
import { InternalOrderType } from './entities/internal-order-type.enum.js';

// Las máquinas de estado de las órdenes, una por tipo, en una sola tabla: qué transición existe,
// quién puede hacerla (cualquiera de `permissions`, más la regla de `actor`) y qué efecto tiene.
// El servicio no decide flujos: busca aquí el paso pedido y aplica su efecto. Las transiciones que
// nadie pide a mano (PAID al cobrar en caja, ITEM_CHANGE_REQUESTED al pedir un cambio, la vuelta a
// RECEIVED_BY_SELLER al unir una sub-orden, RETURN_CREATED → WAITING_FOR_RUNNER al crear una RE) no
// están aquí: las hace el servicio dentro de la operación que las provoca.

export type FlowEffect =
  // bodega toma la orden (queda como responsable)
  | 'ACCEPT'
  // empieza el alistamiento
  | 'PACK'
  // bodega dice cuánto encontró de cada línea; lo faltante abre novedad y se suelta de la reserva
  | 'READY'
  // el corredor la recoge: sale del STOCK de origen a su bolsa
  | 'PICK_UP'
  // el corredor la entrega: de su bolsa al STOCK (o al cajón de devoluciones) del destino
  | 'DELIVER'
  // el vendedor la recibe directo de manos del corredor: entregar y recibir a la vez
  | 'DELIVER_AND_RECEIVE'
  // el destino confirma que llegó
  | 'RECEIVE'
  // el cliente compra: pasa a la cola de cobro de la caja de esa tienda
  | 'TO_PAYMENT'
  // caja la devuelve al vendedor (el cliente todavía no decide)
  | 'BACK_TO_SELLER'
  // el cliente no compra: nace la RE que lleva todo de vuelta a bodega
  | 'RETURN_REQUEST'
  // una sub-orden recibida se suma a su orden original, que sigue hacia el pago
  | 'MERGE'
  // bodega cuenta lo que llegó de una devolución
  | 'VERIFY_RETURN'
  // la devolución pasa del cajón de devoluciones al STOCK de la bodega
  | 'CLOSE_RETURN'
  // un traslado o un surtido se da por terminado
  | 'CLOSE'
  // se anula antes de que el corredor la recoja
  | 'CANCEL';

// Regla de quién, además del permiso:
//   RUNNER     el corredor asignado (o el super admin, por él)
//   REQUESTER  quien la pidió, o quien tenga el permiso (cancelar lo propio no pide permiso de bodega)
export type FlowActor = 'RUNNER' | 'REQUESTER';

export interface FlowStep {
  from: S;
  to: S;
  effect: FlowEffect;
  permissions: PermissionCode[];
  actor?: FlowActor;
  // Qué pasa, en una línea, para la bitácora y el menú de transiciones.
  detail: string;
}

const P = PermissionCode;
const WAREHOUSE = [P.WAREHOUSE_FULFILL_ORDERS];
const RETURNS_DESK = [P.WAREHOUSE_FULFILL_ORDERS, P.WAREHOUSE_RECEIVE_RETURNS];
const PICKUP = [P.RUNNER_PICKUP_ORDERS];
const DELIVERY = [P.RUNNER_CONFIRM_DELIVERY];
const RECEIPT = [P.ORDERS_CONFIRM_RECEIPT];
const RECEIPT_OR_WAREHOUSE = [P.ORDERS_CONFIRM_RECEIPT, P.WAREHOUSE_FULFILL_ORDERS];
const CASH_DESK = [P.CASH_CHARGE_ORDERS, P.CASH_REGISTER_PAYMENT, P.ORDERS_CONFIRM_RECEIPT];
const CANCEL = { effect: 'CANCEL' as const, permissions: WAREHOUSE, actor: 'REQUESTER' as const };

export const FLOWS: Record<InternalOrderType, readonly FlowStep[]> = {
  [InternalOrderType.SO]: [
    { from: S.NEW, to: S.ACCEPTED_BY_WAREHOUSE, effect: 'ACCEPT', permissions: WAREHOUSE, detail: 'Bodega acepta la orden' },
    { from: S.ACCEPTED_BY_WAREHOUSE, to: S.PACKING, effect: 'PACK', permissions: WAREHOUSE, detail: 'Alistamiento iniciado' },
    { from: S.PACKING, to: S.READY_FOR_RUNNER, effect: 'READY', permissions: WAREHOUSE, detail: 'Alistado y notificado a corredores' },
    { from: S.READY_FOR_RUNNER, to: S.IN_TRANSIT, effect: 'PICK_UP', permissions: PICKUP, detail: 'Corredor recoge y transporta' },
    { from: S.IN_TRANSIT, to: S.DELIVERED_TO_STORE, effect: 'DELIVER', permissions: DELIVERY, actor: 'RUNNER', detail: 'Entregado en tienda' },
    { from: S.IN_TRANSIT, to: S.RECEIVED_BY_SELLER, effect: 'DELIVER_AND_RECEIVE', permissions: RECEIPT, detail: 'El vendedor la recibe del corredor' },
    { from: S.DELIVERED_TO_STORE, to: S.RECEIVED_BY_SELLER, effect: 'RECEIVE', permissions: RECEIPT, detail: 'Vendedor confirma recepción' },
    { from: S.RECEIVED_BY_SELLER, to: S.PENDING_PAYMENT, effect: 'TO_PAYMENT', permissions: RECEIPT, detail: 'Cliente decide comprar · enviada a caja' },
    { from: S.RECEIVED_BY_SELLER, to: S.RETURN_REQUESTED, effect: 'RETURN_REQUEST', permissions: RECEIPT, detail: 'Cliente no compra · se genera la devolución' },
    { from: S.RECEIVED_BY_SELLER, to: S.MERGED_INTO_PARENT, effect: 'MERGE', permissions: RECEIPT, detail: 'Los productos se suman a la orden original' },
    { from: S.PENDING_PAYMENT, to: S.RECEIVED_BY_SELLER, effect: 'BACK_TO_SELLER', permissions: CASH_DESK, detail: 'Vuelve al vendedor · el cliente aún no decide' },
    { from: S.PENDING_PAYMENT, to: S.RETURN_REQUESTED, effect: 'RETURN_REQUEST', permissions: CASH_DESK, detail: 'Cliente no compra · se genera la devolución' },
    { from: S.NEW, to: S.CANCELLED, ...CANCEL, detail: 'Orden anulada' },
    { from: S.ACCEPTED_BY_WAREHOUSE, to: S.CANCELLED, ...CANCEL, detail: 'Orden anulada' },
    { from: S.PACKING, to: S.CANCELLED, ...CANCEL, detail: 'Orden anulada' },
    { from: S.READY_FOR_RUNNER, to: S.CANCELLED, ...CANCEL, detail: 'Orden anulada' },
  ],
  [InternalOrderType.RE]: [
    { from: S.WAITING_FOR_RUNNER, to: S.IN_TRANSIT_TO_WAREHOUSE, effect: 'PICK_UP', permissions: PICKUP, detail: 'Corredor transporta hacia bodega' },
    { from: S.IN_TRANSIT_TO_WAREHOUSE, to: S.DELIVERED_TO_WAREHOUSE, effect: 'DELIVER', permissions: DELIVERY, actor: 'RUNNER', detail: 'Entregada en bodega' },
    { from: S.DELIVERED_TO_WAREHOUSE, to: S.RECEIVED_BY_WAREHOUSE, effect: 'VERIFY_RETURN', permissions: RETURNS_DESK, detail: 'Bodega verifica y confirma recepción' },
    { from: S.RECEIVED_BY_WAREHOUSE, to: S.RETURNED, effect: 'CLOSE_RETURN', permissions: RETURNS_DESK, detail: 'Devolución cerrada · movimiento de inventario registrado' },
    { from: S.WAITING_FOR_RUNNER, to: S.CANCELLED, effect: 'CANCEL', permissions: RECEIPT_OR_WAREHOUSE, actor: 'REQUESTER', detail: 'Devolución cancelada · el cliente cambió de opinión' },
  ],
  [InternalOrderType.TR]: [
    { from: S.TRANSFER_REQUESTED, to: S.WAITING_FOR_RUNNER, effect: 'READY', permissions: WAREHOUSE, detail: 'Alistado y notificado a corredores' },
    { from: S.WAITING_FOR_RUNNER, to: S.IN_TRANSIT, effect: 'PICK_UP', permissions: PICKUP, detail: 'Corredor recoge y transporta' },
    { from: S.IN_TRANSIT, to: S.DELIVERED_TO_DESTINATION, effect: 'DELIVER', permissions: DELIVERY, actor: 'RUNNER', detail: 'Entregado en destino' },
    { from: S.DELIVERED_TO_DESTINATION, to: S.RECEIVED_BY_DESTINATION, effect: 'RECEIVE', permissions: RECEIPT_OR_WAREHOUSE, detail: 'Destino confirma recepción' },
    { from: S.RECEIVED_BY_DESTINATION, to: S.TRANSFERRED, effect: 'CLOSE', permissions: RECEIPT_OR_WAREHOUSE, detail: 'Traslado cerrado' },
    { from: S.TRANSFER_REQUESTED, to: S.CANCELLED, ...CANCEL, detail: 'Traslado anulado' },
    { from: S.WAITING_FOR_RUNNER, to: S.CANCELLED, ...CANCEL, detail: 'Traslado anulado' },
  ],
  [InternalOrderType.RS]: [
    { from: S.RESTOCK_REQUESTED, to: S.WAITING_FOR_RUNNER, effect: 'READY', permissions: WAREHOUSE, detail: 'Alistado y notificado a corredores' },
    { from: S.WAITING_FOR_RUNNER, to: S.IN_TRANSIT, effect: 'PICK_UP', permissions: PICKUP, detail: 'Corredor recoge y transporta' },
    { from: S.IN_TRANSIT, to: S.DELIVERED_TO_STORE, effect: 'DELIVER', permissions: DELIVERY, actor: 'RUNNER', detail: 'Entregado en tienda' },
    { from: S.DELIVERED_TO_STORE, to: S.RECEIVED_BY_STORE, effect: 'RECEIVE', permissions: RECEIPT_OR_WAREHOUSE, detail: 'Tienda confirma recepción' },
    { from: S.RECEIVED_BY_STORE, to: S.RESTOCKED, effect: 'CLOSE', permissions: RECEIPT_OR_WAREHOUSE, detail: 'Surtido cerrado' },
    { from: S.RESTOCK_REQUESTED, to: S.CANCELLED, ...CANCEL, detail: 'Surtido anulado' },
    { from: S.WAITING_FOR_RUNNER, to: S.CANCELLED, ...CANCEL, detail: 'Surtido anulado' },
  ],
};

// Con qué estado nace cada tipo.
export const INITIAL_STATUS: Record<InternalOrderType, S> = {
  [InternalOrderType.SO]: S.NEW,
  [InternalOrderType.RE]: S.RETURN_CREATED,
  [InternalOrderType.TR]: S.TRANSFER_REQUESTED,
  [InternalOrderType.RS]: S.RESTOCK_REQUESTED,
};

// Estados finales: ya no admiten ningún cambio.
export const FINAL_STATUSES: readonly S[] = [
  S.PAID,
  S.CANCELLED,
  S.RETURNED,
  S.MERGED_INTO_PARENT,
  S.TRANSFERRED,
  S.RESTOCKED,
];

export const isFinalStatus = (status: S): boolean => FINAL_STATUSES.includes(status);

// Estados en que la mercancía ya salió del origen: de ahí en adelante no se cancela (hay que
// entregarla y devolverla).
export const PICKED_UP_STATUSES: readonly S[] = [
  S.IN_TRANSIT,
  S.DELIVERED_TO_STORE,
  S.RECEIVED_BY_SELLER,
  S.PENDING_PAYMENT,
  S.PAID,
  S.RETURN_REQUESTED,
  S.ITEM_CHANGE_REQUESTED,
  S.MERGED_INTO_PARENT,
  S.IN_TRANSIT_TO_WAREHOUSE,
  S.DELIVERED_TO_WAREHOUSE,
  S.RECEIVED_BY_WAREHOUSE,
  S.RETURNED,
  S.DELIVERED_TO_DESTINATION,
  S.RECEIVED_BY_DESTINATION,
  S.TRANSFERRED,
  S.RECEIVED_BY_STORE,
  S.RESTOCKED,
];

// Estados en que la orden espera que un corredor la tome.
export const WAITING_RUNNER_STATUSES: readonly S[] = [S.READY_FOR_RUNNER, S.WAITING_FOR_RUNNER];

export function stepFor(type: InternalOrderType, from: S, to: S): FlowStep | undefined {
  return FLOWS[type].find((step) => step.from === from && step.to === to);
}

export function stepsFrom(type: InternalOrderType, from: S): FlowStep[] {
  return FLOWS[type].filter((step) => step.from === from);
}
