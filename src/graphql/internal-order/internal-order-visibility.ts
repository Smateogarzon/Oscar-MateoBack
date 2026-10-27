import { Brackets, type SelectQueryBuilder } from 'typeorm';
import { PermissionCode } from '../../common/enums/permission-code.enum.js';
import type { InternalOrder } from './entities/internal-order.entity.js';
import { WAITING_RUNNER_STATUSES } from './internal-order-flow.js';

// Qué órdenes ve cada quien. Se decide por permisos (no por nombre de rol) y los alcances se suman
// cuando alguien tiene varios:
//   todas        orders.view_all, o el super admin.
//   bodega       warehouse.fulfill_orders / warehouse.receive_returns: lo que pasa por sus sedes
//                (Configuración → Personal por ubicación), SALGA de ellas o LLEGUE a ellas. Las dos
//                bodegas de un traslado participan en él desde que se pide, así que las dos lo ven
//                (acordado con el usuario, 2026-10-22). Antes, la de destino no lo veía hasta que el
//                corredor se lo entregaba: se enteraba de que venía algo cuando ya estaba en la
//                puerta. La que no es ni origen ni destino no lo ve: no participa.
//   corredor     runner.pickup_orders / runner.confirm_delivery: las que tomó o lleva (o llevó), y
//                las que esperan corredor sin tomar y salen de o llegan a sus sedes.
//   solicitante  quien pide o recibe (vendedor), o quien no tiene ningún alcance de los anteriores
//                (caja): las que pidió y las que salen de o llegan a sus sedes.
export interface OrderVisibility {
  all: boolean;
  userId: string;
  locationIds: readonly string[];
  warehouse: boolean;
  requester: boolean;
  runner: boolean;
}

export interface VisibilityActor {
  userId: string;
  permissionCodes: readonly string[];
  isSuperAdmin: boolean;
}

const P = PermissionCode;
const WAREHOUSE_SCOPE: readonly string[] = [P.WAREHOUSE_FULFILL_ORDERS, P.WAREHOUSE_RECEIVE_RETURNS];
const RUNNER_SCOPE: readonly string[] = [P.RUNNER_PICKUP_ORDERS, P.RUNNER_CONFIRM_DELIVERY];
const REQUESTER_SCOPE: readonly string[] = [P.ORDERS_REQUEST_FROM_WAREHOUSE, P.ORDERS_CONFIRM_RECEIPT];

export function visibilityOf(actor: VisibilityActor, locationIds: readonly string[]): OrderVisibility {
  const holds = (codes: readonly string[]) => codes.some((code) => actor.permissionCodes.includes(code));
  const all = actor.isSuperAdmin || actor.permissionCodes.includes(P.ORDERS_VIEW_ALL);
  const warehouse = holds(WAREHOUSE_SCOPE);
  const runner = holds(RUNNER_SCOPE);
  const requester = holds(REQUESTER_SCOPE) || (!warehouse && !runner);
  return { all, userId: actor.userId, locationIds, warehouse, requester, runner };
}

export function canSeeOrder(visibility: OrderVisibility, order: Pick<InternalOrder, 'requestedBy' | 'runnerId' | 'status' | 'sourceLocationId' | 'destinationLocationId'>): boolean {
  if (visibility.all) return true;
  const fromMine = visibility.locationIds.includes(order.sourceLocationId);
  const toMine = visibility.locationIds.includes(order.destinationLocationId);
  if (visibility.warehouse && (fromMine || toMine)) return true;
  if (visibility.requester && (fromMine || toMine || order.requestedBy === visibility.userId)) return true;
  if (visibility.runner) {
    if (order.runnerId === visibility.userId) return true;
    if (!order.runnerId && WAITING_RUNNER_STATUSES.includes(order.status) && (fromMine || toMine)) return true;
  }
  return false;
}

// La misma regla, como condición de una consulta sobre `alias`.
export function applyVisibility(query: SelectQueryBuilder<InternalOrder>, alias: string, visibility: OrderVisibility): void {
  if (visibility.all) return;
  const { userId, locationIds } = visibility;
  const hasLocations = locationIds.length > 0;
  const fromMine = `${alias}.sourceLocationId IN (:...visibleLocationIds)`;
  const toMine = `${alias}.destinationLocationId IN (:...visibleLocationIds)`;
  query.andWhere(
    new Brackets((where) => {
      // Una condición siempre falsa para poder sumar con OR lo que aplique.
      where.where('1 = 0');
      if (visibility.warehouse && hasLocations) {
        where.orWhere(`(${fromMine} OR ${toMine})`);
      }
      if (visibility.requester) {
        if (hasLocations) where.orWhere(`(${fromMine} OR ${toMine})`);
        where.orWhere(`${alias}.requestedBy = :visibleUserId`);
      }
      if (visibility.runner) {
        where.orWhere(`${alias}.runnerId = :visibleUserId`);
        if (hasLocations) {
          where.orWhere(`(${alias}.runnerId IS NULL AND ${alias}.status IN (:...waitingRunner) AND (${fromMine} OR ${toMine}))`);
        }
      }
    }),
    {
      visibleUserId: userId,
      visibleLocationIds: hasLocations ? locationIds : [null],
      waitingRunner: WAITING_RUNNER_STATUSES,
    },
  );
}
