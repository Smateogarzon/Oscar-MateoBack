import type { Decimal } from 'decimal.js';
import { In, type EntityManager } from 'typeorm';
import { IncidentStatus } from '../incident/entities/incident-status.enum.js';
import { IncidentType } from '../incident/entities/incident-type.enum.js';
import { Incident } from '../incident/entities/incident.entity.js';
import type { PurchaseOrderItem } from './entities/purchase-order-item.entity.js';
import type { PurchaseOrder } from './entities/purchase-order.entity.js';

// Las novedades de una orden de compra. Se abren solas en los dos conteos del recorrido (ver
// purchase-order-status.enum.ts) y van a la MISMA tabla de novedades que las de los pedidos
// internos, para que el administrador las resuelva donde ya las resuelve:
//   al despachar  el proveedor manda menos de lo que se le pidió (la orden sigue), o manda de más
//                 (y ahí sí se detiene hasta que el administrador autorice el sobrante)
//   al recibir    lo que el bodeguero contó no es lo que el proveedor dijo que mandó (de menos o
//                 de más)
// Son de tipo SUPPLIER_ISSUE —el catálogo ya lo traía reservado para esto— y nacen OPEN, con quién
// la reportó (el proveedor o el bodeguero, cada uno sobre lo que contó).
async function openIncident(
  manager: EntityManager,
  purchaseOrder: PurchaseOrder,
  item: PurchaseOrderItem,
  reportedBy: string,
  title: string,
  description: string,
): Promise<string> {
  const repo = manager.getRepository(Incident);
  const incident = await repo.save(
    repo.create({
      companyId: purchaseOrder.companyId,
      type: IncidentType.SUPPLIER_ISSUE,
      status: IncidentStatus.OPEN,
      title,
      description,
      entityType: 'PURCHASE_ORDER_ITEM',
      entityId: item.id,
      locationId: purchaseOrder.destinationLocationId,
      productVariantId: item.productVariantId,
      reportedBy,
      resolvedBy: null,
      resolvedAt: null,
    }),
  );
  return incident.id;
}

// El proveedor despacha una cantidad distinta de la que se le pidió. De menos, la orden sigue su
// camino con la constancia; de más, queda esperando que el administrador autorice el sobrante.
export function openShipmentMismatch(
  manager: EntityManager,
  purchaseOrder: PurchaseOrder,
  item: PurchaseOrderItem,
  supplierUserId: string,
  shipped: Decimal,
): Promise<string> {
  const over = shipped.greaterThan(item.quantity);
  return openIncident(
    manager,
    purchaseOrder,
    item,
    supplierUserId,
    `${over ? 'Sobrante' : 'Faltante'} del proveedor en la orden ${purchaseOrder.orderNumber}`,
    `Se pidieron ${item.quantity.toFixed(2)} y el proveedor despachó ${shipped.toFixed(2)}`,
  );
}

// En bodega no se cuenta lo mismo que despachó el proveedor: falta mercancía o llegó de más.
export function openReceptionMismatch(
  manager: EntityManager,
  purchaseOrder: PurchaseOrder,
  item: PurchaseOrderItem,
  warehouseUserId: string,
  shipped: Decimal,
  counted: Decimal,
): Promise<string> {
  const short = counted.lessThan(shipped);
  return openIncident(
    manager,
    purchaseOrder,
    item,
    warehouseUserId,
    `${short ? 'Faltante' : 'Sobrante'} al recibir la orden ${purchaseOrder.orderNumber}`,
    `El proveedor despachó ${shipped.toFixed(2)} y en bodega se contaron ${counted.toFixed(2)}`,
  );
}

// El administrador zanja las novedades de un despacho: las del sobrante que autoriza quedan
// RESUELTAS (con él como quien las resolvió) y, si devuelve el despacho al proveedor, TODAS las de
// ese despacho quedan CANCELADAS: ese despacho ya no existe, y el que venga traerá las suyas.
export async function closeShipmentIncidents(
  manager: EntityManager,
  incidentIds: readonly string[],
  actorUserId: string,
  status: IncidentStatus.RESOLVED | IncidentStatus.CANCELLED,
): Promise<void> {
  if (incidentIds.length === 0) return;
  const repo = manager.getRepository(Incident);
  const incidents = await repo.find({
    where: { id: In([...incidentIds]) },
    lock: { mode: 'pessimistic_write' },
  });
  const resolvedAt = new Date();
  for (const incident of incidents) {
    incident.status = status;
    incident.resolvedBy = actorUserId;
    incident.resolvedAt = resolvedAt;
  }
  await repo.save(incidents);
}
