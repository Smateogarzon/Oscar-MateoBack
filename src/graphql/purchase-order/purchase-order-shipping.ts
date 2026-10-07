import { BadRequestException, ConflictException } from '@nestjs/common';
import { Decimal } from 'decimal.js';
import type { EntityManager } from 'typeorm';
import { IncidentStatus } from '../incident/entities/incident-status.enum.js';
import type { PurchaseOrderItemCountInput } from './dto/purchase-order-item-count.input.js';
import { PurchaseOrderItem } from './entities/purchase-order-item.entity.js';
import type { PurchaseOrder } from './entities/purchase-order.entity.js';
import { closeShipmentIncidents, openShipmentMismatch } from './purchase-order-incidents.js';
import { countedByItem, loadPurchaseOrderItems } from './purchase-order-lines.js';

// Lo que deja un despacho: si alguna línea trae sobrante (y entonces la orden espera al
// administrador) y si quedó alguna novedad, de menos o de más.
export interface ShipmentResult {
  hasOverage: boolean;
  hasIncidents: boolean;
}

// Lo que hace de verdad "despachar" una orden: el proveedor cuenta su mercancía y deja escrito, por
// cada línea, cuánto manda. No toca inventario —la existencia entra cuando bodega la recibe y la
// cuenta (ver PurchaseOrderReceivingService)—: acá solo se anota lo despachado y, donde no coincida
// con lo pedido, nace la novedad de esa línea.
//
// Puede mandar MÁS de lo que se le pidió: eso no se bloquea, pero tampoco pasa derecho a la bodega.
// La orden queda esperando a que el administrador autorice el sobrante línea por línea (ver
// PurchaseOrderService.resolveOverage).
//
// Se despacha UNA vez y se cuentan TODAS las líneas: una referencia que el proveedor no tiene se
// manda en 0 (con su novedad), no se omite, porque omitirla sería no haberla contado.
export async function registerShipment(
  manager: EntityManager,
  supplierUserId: string,
  purchaseOrder: PurchaseOrder,
  shipped: readonly PurchaseOrderItemCountInput[],
): Promise<ShipmentResult> {
  const items = await loadPurchaseOrderItems(manager, purchaseOrder.id);
  if (items.length === 0) throw new ConflictException('Esta orden no tiene líneas que despachar');

  const counted = countedByItem(items, shipped, {
    unknownItem: (itemId) => `La línea ${itemId} no es de esta orden`,
    repeated: 'Una línea viene repetida en el despacho',
    missing: 'Falta contar una referencia de la orden',
  });
  if (items.every((item) => counted.get(item.id)!.isZero())) {
    throw new BadRequestException('Indica al menos una cantidad despachada');
  }

  const result: ShipmentResult = { hasOverage: false, hasIncidents: false };
  for (const item of items) {
    const quantity = counted.get(item.id)!;
    item.shippedQuantity = quantity;
    if (!quantity.equals(item.quantity)) {
      item.shipmentIncidentId = await openShipmentMismatch(manager, purchaseOrder, item, supplierUserId, quantity);
      result.hasIncidents = true;
      if (quantity.greaterThan(item.quantity)) result.hasOverage = true;
    }
  }
  await manager.getRepository(PurchaseOrderItem).save(items);
  return result;
}

// Las líneas de la orden con el sobrante que el administrador tiene que autorizar, en el orden en
// que se arman en pantalla.
export async function overageItems(
  manager: EntityManager,
  purchaseOrder: PurchaseOrder,
): Promise<PurchaseOrderItem[]> {
  const items = await loadPurchaseOrderItems(manager, purchaseOrder.id);
  return items.filter((item) => (item.shippedQuantity ?? new Decimal(0)).greaterThan(item.quantity));
}

// Deshace el despacho entero: el administrador rechazó el sobrante de alguna línea, así que la
// orden vuelve a manos del proveedor como si no hubiera despachado. Las novedades de ESE despacho
// quedan canceladas (ya no describen nada vigente) y las cifras, en blanco: el proveedor vuelve a
// contar y vuelve a despachar.
export async function clearShipment(
  manager: EntityManager,
  purchaseOrder: PurchaseOrder,
  actorUserId: string,
): Promise<void> {
  const items = await loadPurchaseOrderItems(manager, purchaseOrder.id);
  const incidentIds = items.map((item) => item.shipmentIncidentId).filter((id): id is string => id !== null);

  await closeShipmentIncidents(manager, incidentIds, actorUserId, IncidentStatus.CANCELLED);
  await manager
    .getRepository(PurchaseOrderItem)
    .save(items.map((item) => ({ ...item, shippedQuantity: null, shipmentIncidentId: null })));
}
