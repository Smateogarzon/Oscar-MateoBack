import { PermissionCode } from '../../common/enums/permission-code.enum.js';
import { InternalOrderStatus as S } from './entities/internal-order-status.enum.js';
import { InternalOrderType } from './entities/internal-order-type.enum.js';

// Las máquinas de estado de las órdenes, una por tipo, en una sola tabla: qué transición existe,
// quién puede hacerla (cualquiera de `permissions`, más la regla de `actor`) y qué efecto tiene.
// El servicio no decide flujos: busca aquí el paso pedido y aplica su efecto. Las transiciones que
// nadie pide a mano (PAID al cobrar en caja, ITEM_CHANGE_REQUESTED al pedir un cambio,
// CLOSED_BY_CHANGE cuando la sub-orden de un cambio llega y la original termina sin cobro,
// RETURN_CREATED → WAITING_FOR_RUNNER al crear una RE) no están aquí: las hace el servicio dentro
// de la operación que las provoca.

export type FlowEffect =
  // bodega toma la orden y empieza a alistarla (queda como responsable)
  | 'PACK'
  // bodega dice cuánto encontró de cada línea; lo faltante abre novedad y se suelta de la reserva
  | 'READY'
  // el corredor que la tomó (claimInternalOrder) la recoge: sale del STOCK de origen a su bolsa
  | 'PICK_UP'
  // el corredor marca que la entregó físicamente; sigue bajo su custodia (en su bolsa) hasta que el
  // destino confirme: son dos eventos distintos, nunca uno solo
  | 'DELIVER'
  // el destino confirma que la recibió: termina la custodia del corredor y pasa de su bolsa al STOCK
  // del destino
  | 'RECEIVE'
  // el cliente compra: pasa a la cola de cobro de la caja de esa tienda
  | 'TO_PAYMENT'
  // caja la devuelve al vendedor (el cliente todavía no decide)
  | 'BACK_TO_SELLER'
  // el cliente no compra: lo que tiene va al cajón de devoluciones de la tienda y la orden se cierra
  // como devuelta (la RE la arma después el administrador con lo acumulado)
  | 'RETURN_REQUEST'
  // bodega recibe una devolución: cuenta lo que llegó (termina la custodia del corredor, pasa de su
  // bolsa al cajón de devoluciones) y lo contado entra al STOCK · cierra el ticket
  | 'VERIFY_RETURN'
  // heredado: la devolución que quedó recibida con la regla anterior pasa del cajón al STOCK
  | 'CLOSE_RETURN'
  // un traslado o un surtido se da por terminado
  | 'CLOSE'
  // se anula antes de que el corredor la recoja
  | 'CANCEL';

// Regla de quién, además del permiso:
//   RUNNER     el corredor asignado (o el super admin, por él)
//   REQUESTER  quien la pidió, o quien tenga el permiso
//   ADMIN      solo quien administra la empresa (Administrador) o la plataforma (super admin); no
//              depende de permisos
export type FlowActor = 'RUNNER' | 'REQUESTER' | 'ADMIN';

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
// Anular una SO, un TR o un RS antes de que lo recoja el corredor es solo del administrador (ni bodega,
// ni el corredor, ni quien lo pidió). Cancelar una devolución (RE) sigue su propia regla.
const CANCEL = { effect: 'CANCEL' as const, permissions: [], actor: 'ADMIN' as const };

export const FLOWS: Record<InternalOrderType, readonly FlowStep[]> = {
  [InternalOrderType.SO]: [
    { from: S.NEW, to: S.PACKING, effect: 'PACK', permissions: WAREHOUSE, detail: 'Bodega toma la orden · alistamiento iniciado' },
    // Heredado: ya no se acepta antes de alistar, pero una orden que quedó aceptada sigue su camino.
    { from: S.ACCEPTED_BY_WAREHOUSE, to: S.PACKING, effect: 'PACK', permissions: WAREHOUSE, detail: 'Alistamiento iniciado' },
    { from: S.PACKING, to: S.READY_FOR_RUNNER, effect: 'READY', permissions: WAREHOUSE, detail: 'Alistado y notificado a corredores' },
    { from: S.READY_FOR_RUNNER, to: S.IN_TRANSIT, effect: 'PICK_UP', permissions: PICKUP, detail: 'Corredor recoge y transporta' },
    { from: S.IN_TRANSIT, to: S.DELIVERED_TO_STORE, effect: 'DELIVER', permissions: DELIVERY, actor: 'RUNNER', detail: 'Entregado en tienda' },
    { from: S.DELIVERED_TO_STORE, to: S.RECEIVED_BY_SELLER, effect: 'RECEIVE', permissions: RECEIPT, detail: 'Vendedor confirma recepción' },
    { from: S.RECEIVED_BY_SELLER, to: S.PENDING_PAYMENT, effect: 'TO_PAYMENT', permissions: RECEIPT, detail: 'Cliente decide comprar · enviada a caja' },
    { from: S.RECEIVED_BY_SELLER, to: S.RETURNED, effect: 'RETURN_REQUEST', permissions: RECEIPT, detail: 'Cliente no compra · al cajón de devoluciones' },
    { from: S.PENDING_PAYMENT, to: S.RECEIVED_BY_SELLER, effect: 'BACK_TO_SELLER', permissions: CASH_DESK, detail: 'Vuelve al vendedor · el cliente aún no decide' },
    { from: S.PENDING_PAYMENT, to: S.RETURNED, effect: 'RETURN_REQUEST', permissions: CASH_DESK, detail: 'Cliente no compra · al cajón de devoluciones' },
    { from: S.NEW, to: S.CANCELLED, ...CANCEL, detail: 'Orden anulada' },
    { from: S.ACCEPTED_BY_WAREHOUSE, to: S.CANCELLED, ...CANCEL, detail: 'Orden anulada' },
    { from: S.PACKING, to: S.CANCELLED, ...CANCEL, detail: 'Orden anulada' },
    { from: S.READY_FOR_RUNNER, to: S.CANCELLED, ...CANCEL, detail: 'Orden anulada' },
  ],
  [InternalOrderType.RE]: [
    { from: S.WAITING_FOR_RUNNER, to: S.IN_TRANSIT_TO_WAREHOUSE, effect: 'PICK_UP', permissions: PICKUP, detail: 'Corredor transporta hacia bodega' },
    { from: S.IN_TRANSIT_TO_WAREHOUSE, to: S.DELIVERED_TO_WAREHOUSE, effect: 'DELIVER', permissions: DELIVERY, actor: 'RUNNER', detail: 'Entregada en bodega' },
    // Recibir en bodega cierra el ticket: se cuenta lo que llegó, entra a la existencia y la
    // devolución queda cerrada en un solo paso.
    { from: S.DELIVERED_TO_WAREHOUSE, to: S.RETURNED, effect: 'VERIFY_RETURN', permissions: RETURNS_DESK, detail: 'Bodega recibe y cuenta · devolución cerrada' },
    // Heredado: las devoluciones que quedaron recibidas sin cerrar cuando eran dos pasos.
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
  S.CLOSED_BY_CHANGE,
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
  S.CLOSED_BY_CHANGE,
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

// Estados en que el corredor todavía responde por la orden: la tomó (espera en bodega), la lleva, o
// la entregó y espera la confirmación del receptor. Con la confirmación termina su custodia.
export const RUNNER_ENGAGED_STATUSES: readonly S[] = [
  ...WAITING_RUNNER_STATUSES,
  S.IN_TRANSIT,
  S.IN_TRANSIT_TO_WAREHOUSE,
  S.DELIVERED_TO_STORE,
  S.DELIVERED_TO_WAREHOUSE,
  S.DELIVERED_TO_DESTINATION,
];

// Los pasos que hace la bodega con la mercancía delante, y en qué sede de la orden está esa
// mercancía. Quien los da tiene que tener esa sede asignada (Configuración → Personal por
// ubicación): un bodeguero alista y despacha lo de SUS bodegas, no lo de cualquiera. Alistar
// (PACK/READY) pasa en el origen; recibir una devolución (VERIFY_RETURN/CLOSE_RETURN), en el
// destino, que en una RE es la bodega que la recibe.
export const WAREHOUSE_EFFECT_AT: Partial<Record<FlowEffect, 'SOURCE' | 'DESTINATION'>> = {
  PACK: 'SOURCE',
  READY: 'SOURCE',
  VERIFY_RETURN: 'DESTINATION',
  CLOSE_RETURN: 'DESTINATION',
};

export function stepFor(type: InternalOrderType, from: S, to: S): FlowStep | undefined {
  return FLOWS[type].find((step) => step.from === from && step.to === to);
}

export function stepsFrom(type: InternalOrderType, from: S): FlowStep[] {
  return FLOWS[type].filter((step) => step.from === from);
}
