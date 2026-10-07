import { ConflictException, Injectable } from '@nestjs/common';
import { Decimal } from 'decimal.js';
import type { EntityManager } from 'typeorm';
import { InventoryLocationService } from '../inventory-location/inventory-location.service.js';
import { InventoryMovementType } from '../inventory-movement/entities/inventory-movement-type.enum.js';
import { InventorySourceType } from '../inventory-movement/entities/inventory-source-type.enum.js';
import { InventoryMovementService } from '../inventory-movement/inventory-movement.service.js';
import type { PurchaseOrderItemCountInput } from './dto/purchase-order-item-count.input.js';
import { PurchaseOrderItem } from './entities/purchase-order-item.entity.js';
import { PurchaseOrder } from './entities/purchase-order.entity.js';
import { openReceptionMismatch } from './purchase-order-incidents.js';
import { countedByItem, loadPurchaseOrderItems } from './purchase-order-lines.js';

// Lo que hace de verdad "recibir" una orden de compra: el BODEGUERO cuenta lo que llegó y, por cada
// línea, entra una fila de movimiento PURCHASE hacia el STOCK de la sede destino con lo que él
// contó —no con lo pedido ni con lo que dice el proveedor que despachó—. Es lo único de la orden
// que toca inventario (igual que WriteOffService.approve con las bajas), y corre dentro de la
// transacción de quien lo llama: o se guarda todo, o nada. Es un servicio (y no funciones sueltas
// como el despacho) porque necesita los de inventario inyectados.
//
// Si lo contado no coincide con lo despachado, la mercancía igual entra (es la que está en la
// bodega) y la diferencia queda como novedad en esa línea, de menos o de más.
@Injectable()
export class PurchaseOrderReceivingService {
  constructor(
    private readonly inventoryMovements: InventoryMovementService,
    private readonly inventoryLocations: InventoryLocationService,
  ) {}

  // Devuelve si en algún renglón lo contado no fue lo despachado: eso es lo que marca la orden
  // como "con novedad" (ver PurchaseOrder.hasIncidents).
  async receive(
    manager: EntityManager,
    companyId: string,
    warehouseUserId: string,
    purchaseOrder: PurchaseOrder,
    counted: readonly PurchaseOrderItemCountInput[],
  ): Promise<boolean> {
    const items = await loadPurchaseOrderItems(manager, purchaseOrder.id);
    if (items.length === 0) throw new ConflictException('Esta orden no tiene líneas que recibir');

    // Solo se cuenta lo que el proveedor dijo haber despachado: lo que mandó en 0 ya tiene su
    // novedad y no hay nada que contar en la bodega. Lo que llegó de más también se recibe: lo que
    // entra al inventario es lo que está en la bodega, y la diferencia queda como novedad.
    const shippedItems = items.filter((item) => (item.shippedQuantity ?? new Decimal(0)).greaterThan(0));
    if (shippedItems.length === 0) throw new ConflictException('El proveedor no despachó nada de esta orden');

    const countedByLine = countedByItem(shippedItems, counted, {
      unknownItem: (itemId) => `La línea ${itemId} no se despachó en esta orden`,
      repeated: 'Una línea viene repetida en la recepción',
      missing: 'Falta contar una referencia de las que despachó el proveedor',
    });
    let mismatched = false;
    const stockLocation = await this.inventoryLocations.findStockLocation(
      manager,
      companyId,
      purchaseOrder.destinationLocationId,
    );

    for (const item of shippedItems) {
      const quantity = countedByLine.get(item.id)!;
      const shipped = item.shippedQuantity ?? new Decimal(0);
      item.receivedQuantity = quantity;

      if (quantity.greaterThan(0)) {
        await this.inventoryMovements.recordInTransaction(manager, companyId, warehouseUserId, {
          productVariantId: item.productVariantId,
          toLocationId: stockLocation.id,
          quantity,
          type: InventoryMovementType.PURCHASE,
          sourceType: InventorySourceType.PURCHASE_ORDER,
          sourceId: purchaseOrder.id,
          sourceNumber: purchaseOrder.orderNumber,
          notes: `Orden de compra ${purchaseOrder.orderNumber}`,
        });
      }

      if (!quantity.equals(shipped)) {
        mismatched = true;
        item.receptionIncidentId = await openReceptionMismatch(
          manager,
          purchaseOrder,
          item,
          warehouseUserId,
          shipped,
          quantity,
        );
      }
    }
    await manager.getRepository(PurchaseOrderItem).save(shippedItems);
    return mismatched;
  }
}
