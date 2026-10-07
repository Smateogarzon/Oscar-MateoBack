import { ConflictException, Injectable } from '@nestjs/common';
import { Decimal } from 'decimal.js';
import type { EntityManager } from 'typeorm';
import { InventoryLocationService } from '../inventory-location/inventory-location.service.js';
import { InventoryMovementType } from '../inventory-movement/entities/inventory-movement-type.enum.js';
import { InventorySourceType } from '../inventory-movement/entities/inventory-source-type.enum.js';
import { InventoryMovementService } from '../inventory-movement/inventory-movement.service.js';
import { InventoryReservationService } from '../inventory-reservation/inventory-reservation.service.js';
import { releaseReservations } from '../inventory-reservation/reserved-quantity.js';
import { Location } from '../location/entities/location.entity.js';
import { ProductVariant } from '../product-variant/entities/product-variant.entity.js';
import type { InternalOrderItem } from './entities/internal-order-item.entity.js';
import type { InternalOrder } from './entities/internal-order.entity.js';

// Cantidad por variante (una variante puede repetirse en varias líneas).
export type VariantQuantities = Map<string, Decimal>;

// Lo que mueve una orden por cada línea: lo que bodega encontró si ya alistó, si no lo pedido. Las
// líneas en 0 no cuentan (no hay nada que apartar ni que llevar).
export function quantitiesOf(
  items: readonly Pick<InternalOrderItem, 'productVariantId' | 'quantity'>[] | readonly InternalOrderItem[],
): VariantQuantities {
  const quantities: VariantQuantities = new Map();
  for (const item of items) {
    const quantity = ('foundQuantity' in item ? item.foundQuantity : null) ?? item.quantity;
    if (quantity.lessThanOrEqualTo(0)) continue;
    quantities.set(item.productVariantId, (quantities.get(item.productVariantId) ?? new Decimal(0)).plus(quantity));
  }
  return quantities;
}

// Todo lo que una orden aparta o mueve de inventario. Cada orden aparta en UN solo lugar a la vez
// (la bodega de origen antes de que el corredor la recoja; la tienda cuando una SO ya llegó), con
// sourceType TRANSFER_REQUEST y sourceId = la orden: así se suelta entera de una vez. Los movimientos
// van a nombre de quien hace el paso, con el número de la orden como referencia en el kárdex.
@Injectable()
export class InternalOrderStock {
  constructor(
    private readonly reservations: InventoryReservationService,
    private readonly movements: InventoryMovementService,
    private readonly inventoryLocations: InventoryLocationService,
  ) {}

  // Deja apartado para la orden exactamente `quantities` en el STOCK de la sede `locationId`, y nada
  // más (lo que apartaba antes, donde fuera, se suelta primero). Si no alcanza, lo dice con el
  // nombre del producto y de la sede.
  async reserveAt(
    manager: EntityManager,
    companyId: string,
    order: InternalOrder,
    locationId: string,
    quantities: VariantQuantities,
    actorId: string,
  ): Promise<void> {
    await this.release(manager, order.id);
    if (quantities.size === 0) return;
    const stock = await this.inventoryLocations.findStockLocation(manager, companyId, locationId);
    for (const [productVariantId, quantity] of quantities) {
      try {
        await this.reservations.reserveInTransaction(manager, companyId, {
          productVariantId,
          inventoryLocationId: stock.id,
          quantity,
          sourceType: InventorySourceType.TRANSFER_REQUEST,
          sourceId: order.id,
          sourceNumber: order.orderNumber,
          reservedBy: actorId,
        });
      } catch (error) {
        if (!(error instanceof ConflictException)) throw error;
        throw new ConflictException(await this.shortageMessage(manager, productVariantId, locationId, error.message));
      }
    }
  }

  async release(manager: EntityManager, orderId: string): Promise<void> {
    await releaseReservations(manager, InventorySourceType.TRANSFER_REQUEST, [orderId]);
  }

  // El corredor recoge: del STOCK del origen a su bolsa (se crea sola la primera vez).
  async toRunner(
    manager: EntityManager,
    companyId: string,
    order: InternalOrder,
    runnerId: string,
    quantities: VariantQuantities,
    actorId: string,
  ): Promise<void> {
    const from = await this.inventoryLocations.findStockLocation(manager, companyId, order.sourceLocationId);
    const bag = await this.inventoryLocations.findOrCreateRunnerLocation(manager, companyId, runnerId);
    await this.move(manager, companyId, order, from.id, bag.id, quantities, InventoryMovementType.RUNNER_PICKUP, actorId);
  }

  // El corredor entrega: de su bolsa al STOCK del destino, o a su cajón de devoluciones (una RE
  // llega a bodega y no vuelve a la venta hasta que bodega la verifica y la cierra).
  async fromRunner(
    manager: EntityManager,
    companyId: string,
    order: InternalOrder,
    runnerId: string,
    quantities: VariantQuantities,
    into: 'STOCK' | 'RETURNS',
    actorId: string,
  ): Promise<void> {
    const bag = await this.inventoryLocations.findOrCreateRunnerLocation(manager, companyId, runnerId);
    const to =
      into === 'RETURNS'
        ? await this.inventoryLocations.findOrCreateReturnsLocation(manager, companyId, order.destinationLocationId)
        : await this.inventoryLocations.findStockLocation(manager, companyId, order.destinationLocationId);
    await this.move(manager, companyId, order, bag.id, to.id, quantities, InventoryMovementType.RUNNER_DELIVERY, actorId);
  }

  // Bodega cierra una devolución: lo verificado pasa del cajón de devoluciones a su STOCK, donde
  // vuelve a estar disponible.
  async returnsToStock(
    manager: EntityManager,
    companyId: string,
    order: InternalOrder,
    quantities: VariantQuantities,
    actorId: string,
  ): Promise<void> {
    const from = await this.inventoryLocations.findOrCreateReturnsLocation(manager, companyId, order.destinationLocationId);
    const to = await this.inventoryLocations.findStockLocation(manager, companyId, order.destinationLocationId);
    await this.move(manager, companyId, order, from.id, to.id, quantities, InventoryMovementType.RETURN, actorId);
  }

  private async move(
    manager: EntityManager,
    companyId: string,
    order: InternalOrder,
    fromLocationId: string,
    toLocationId: string,
    quantities: VariantQuantities,
    type: InventoryMovementType,
    actorId: string,
  ): Promise<void> {
    for (const [productVariantId, quantity] of quantities) {
      await this.movements.recordInTransaction(manager, companyId, actorId, {
        productVariantId,
        fromLocationId,
        toLocationId,
        quantity,
        type,
        sourceType: InventorySourceType.TRANSFER_REQUEST,
        sourceId: order.id,
        sourceNumber: order.orderNumber,
        notes: `Orden #${order.orderNumber}`,
      });
    }
  }

  private async shortageMessage(
    manager: EntityManager,
    productVariantId: string,
    locationId: string,
    detail: string,
  ): Promise<string> {
    const variant = await manager.getRepository(ProductVariant).findOne({
      where: { id: productVariantId },
      relations: { product: true, color: true, size: true },
    });
    const location = await manager.getRepository(Location).findOneBy({ id: locationId });
    const what = variant ? `${variant.product.name} ${variant.color.name} / ${variant.size.name}` : 'una referencia';
    return `No hay suficiente ${what} en ${location?.name ?? 'el origen'}: ${detail}`;
  }
}
