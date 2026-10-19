import { Injectable } from '@nestjs/common';
import { Decimal } from 'decimal.js';
import { DataSource, In, type EntityManager } from 'typeorm';
import { InventoryLocationType } from '../inventory-location/entities/inventory-location-type.enum.js';
import { InventoryLocationService } from '../inventory-location/inventory-location.service.js';
import { InventorySourceType } from '../inventory-movement/entities/inventory-source-type.enum.js';
import { InventoryReservation } from '../inventory-reservation/entities/inventory-reservation.entity.js';
import { InventoryReservationService } from '../inventory-reservation/inventory-reservation.service.js';
import { releaseReservations } from '../inventory-reservation/reserved-quantity.js';
import { LocationType } from '../location/entities/location-type.enum.js';
import { Location } from '../location/entities/location.entity.js';
import { InternalOrder } from '../internal-order/entities/internal-order.entity.js';
import { SaleReturn } from '../sale-return/entities/sale-return.entity.js';
import { Sale } from '../sale/entities/sale.entity.js';
import { NotificationEntityType } from '../notification/entities/notification-entity-type.enum.js';
import { NotificationType } from '../notification/entities/notification-type.enum.js';
import { NotificationService } from '../notification/notification.service.js';
import { RecordStatus } from '../../common/enums/record-status.enum.js';

// Cantidad por variante.
export type BinQuantities = Map<string, Decimal>;

// De dónde llegó lo que entra al cajón: el pedido (SO) que el cliente no compró o cambió, la venta de
// la que caja quitó algo, o la devolución de una venta cobrada. Queda como sourceId/sourceNumber de
// la reserva: así cada zapato del cajón dice de dónde salió.
export interface BinOrigin {
  id: string;
  number: string | null;
}

/**
 * El cajón de devoluciones de cada tienda. Lo que el cliente no se lleva no vuelve a bodega de
 * inmediato: queda en el STOCK de la tienda —se sigue viendo en Inventario, en la tienda— apartado a
 * nombre del cajón (reserva RETURNS_BIN), así nadie lo vende. Al administrador le llega un aviso, y
 * cuando lo ve necesario arma una RE con lo acumulado (InternalOrderService.createReturnFromBin).
 *
 * No aplica al retorno por error del corredor (InternalOrderCorrection), que sigue su propio camino.
 */
@Injectable()
export class ReturnsBinService {
  constructor(
    private readonly dataSource: DataSource,
    private readonly reservations: InventoryReservationService,
    private readonly inventoryLocations: InventoryLocationService,
    private readonly notifications: NotificationService,
  ) {}

  // Aparta en el cajón de `storeId` estas cantidades, a nombre de `origin`. Con `notify`, avisa al
  // administrador.
  async hold(
    manager: EntityManager,
    companyId: string,
    input: { storeId: string; origin: BinOrigin; quantities: BinQuantities; actorId: string; notify: boolean },
  ): Promise<void> {
    const positive = [...input.quantities].filter(([, quantity]) => quantity.greaterThan(0));
    if (positive.length === 0) return;
    const stock = await this.inventoryLocations.findStockLocation(manager, companyId, input.storeId);
    for (const [productVariantId, quantity] of positive) {
      await this.reservations.reserveInTransaction(manager, companyId, {
        productVariantId,
        inventoryLocationId: stock.id,
        quantity,
        sourceType: InventorySourceType.RETURNS_BIN,
        sourceId: input.origin.id,
        sourceNumber: input.origin.number,
        reservedBy: input.actorId,
      });
    }
    if (input.notify) {
      const total = positive.reduce((sum, [, quantity]) => sum.plus(quantity), new Decimal(0));
      await this.notifyAdmins(manager, companyId, input.storeId, input.origin, total, input.actorId);
    }
  }

  // Cuánto tiene en el cajón un origen (para avisar solo cuando crece).
  async heldFor(manager: EntityManager, originId: string): Promise<Decimal> {
    const rows = await this.reservations.findForSource(manager, InventorySourceType.RETURNS_BIN, originId);
    return rows.reduce((sum, row) => sum.plus(row.quantity), new Decimal(0));
  }

  // Saca del cajón todo lo de un origen (vuelve a estar disponible en la tienda).
  async release(manager: EntityManager, originId: string): Promise<void> {
    await releaseReservations(manager, InventorySourceType.RETURNS_BIN, [originId]);
  }

  // Lo que hay en el cajón de las tiendas de la empresa, de lo más viejo a lo más nuevo, con la
  // variante y la tienda cargadas.
  contents(companyId: string): Promise<InventoryReservation[]> {
    return this.dataSource.manager.find(InventoryReservation, {
      where: {
        sourceType: InventorySourceType.RETURNS_BIN,
        inventoryLocation: { companyId, type: InventoryLocationType.STOCK, location: { type: LocationType.STORE } },
      },
      relations: { inventoryLocation: { location: true }, productVariant: { product: true, color: true, size: true }, reservedByUser: true },
      order: { createdAt: 'ASC' },
    });
  }

  // Las entradas del cajón de `storeId` de esas variantes, bloqueadas para trabajar con ellas (crear
  // la RE las saca del cajón). Lo más viejo primero, como se muestran.
  async lockFor(
    manager: EntityManager,
    companyId: string,
    storeId: string,
    productVariantIds: readonly string[],
  ): Promise<InventoryReservation[]> {
    if (productVariantIds.length === 0) return [];
    const stock = await this.inventoryLocations.findStockLocation(manager, companyId, storeId);
    return manager.getRepository(InventoryReservation).find({
      where: {
        sourceType: InventorySourceType.RETURNS_BIN,
        inventoryLocationId: stock.id,
        productVariantId: In([...productVariantIds]),
      },
      order: { createdAt: 'ASC' },
      lock: { mode: 'pessimistic_write' },
    });
  }

  // Saca del cajón estas entradas, enteras: quien las tome las vuelve a apartar a su nombre en la
  // misma transacción. Se toman filas completas y no cantidades, porque cada fila es lo que llegó de
  // UN documento y es ella la que sabe de qué bodega salió: partirla perdería esa cuenta.
  async takeRows(manager: EntityManager, rows: readonly InventoryReservation[]): Promise<string[]> {
    if (rows.length === 0) return [];
    await manager.getRepository(InventoryReservation).remove([...rows]);
    return [...new Set(rows.flatMap((row) => (row.sourceNumber ? [row.sourceNumber] : [])))];
  }

  /**
   * De qué bodega salió cada cosa del cajón, por el documento que la dejó ahí (`sourceId`), para
   * devolverla a donde era (acordado con el usuario, 2026-10-15). Se resuelve en tres saltos:
   *
   *   · el cajón lo llenó un pedido (SO)  → la bodega que lo despachó;
   *   · lo llenó una venta (caja le quitó una línea) → la bodega del pedido que esa venta cobraba;
   *   · lo llenó una devolución de venta  → lo mismo, por la venta original.
   *
   * Devuelve un mapa por `sourceId`; lo que no lleva a ninguna bodega activa no entra en el mapa, y
   * eso es una respuesta válida: la mercancía que la tienda vendía directo nunca salió de una bodega
   * y no hay a dónde devolverla (se queda en el cajón).
   */
  async originWarehouses(
    manager: EntityManager,
    companyId: string,
    rows: readonly InventoryReservation[],
  ): Promise<Map<string, Location>> {
    const sourceIds = [...new Set(rows.flatMap((row) => (row.sourceId ? [row.sourceId] : [])))];
    if (sourceIds.length === 0) return new Map();

    // Salto 1: los que ya son un pedido.
    const orderOfSource = new Map<string, string>();
    const orders = await manager.getRepository(InternalOrder).find({
      select: { id: true, sourceLocationId: true },
      where: { id: In(sourceIds), companyId },
    });
    for (const order of orders) orderOfSource.set(order.id, order.sourceLocationId);

    // Salto 2: una venta, o la venta original de una devolución, que cobraba un pedido.
    const returns = await manager.getRepository(SaleReturn).find({
      select: { id: true, saleId: true },
      where: { id: In(sourceIds), companyId },
    });
    const saleOfSource = new Map<string, string>(returns.map((saleReturn) => [saleReturn.id, saleReturn.saleId]));
    const saleIds = [...new Set([...sourceIds, ...saleOfSource.values()])];
    const sales = await manager.getRepository(Sale).find({
      select: { id: true, internalOrderId: true },
      where: { id: In(saleIds), companyId },
    });
    const orderOfSale = new Map<string, string>(
      sales.flatMap((sale) => (sale.internalOrderId ? [[sale.id, sale.internalOrderId] as [string, string]] : [])),
    );

    // Salto 3: la bodega de esos pedidos.
    const pendingOrderIds = [...new Set(orderOfSale.values())].filter((id) => !orderOfSource.has(id));
    if (pendingOrderIds.length > 0) {
      const more = await manager.getRepository(InternalOrder).find({
        select: { id: true, sourceLocationId: true },
        where: { id: In(pendingOrderIds), companyId },
      });
      for (const order of more) orderOfSource.set(order.id, order.sourceLocationId);
    }

    const locationOf = (sourceId: string): string | undefined => {
      const direct = orderOfSource.get(sourceId);
      if (direct) return direct;
      const saleId = saleOfSource.get(sourceId) ?? sourceId;
      const orderId = orderOfSale.get(saleId);
      return orderId ? orderOfSource.get(orderId) : undefined;
    };

    // Solo bodegas activas: una sede desactivada (o una tienda, si el origen fue un traslado entre
    // tiendas) no es un destino al que mandar un corredor.
    const locationIds = [...new Set(sourceIds.flatMap((id) => { const at = locationOf(id); return at ? [at] : []; }))];
    if (locationIds.length === 0) return new Map();
    const warehouses = await manager.getRepository(Location).find({
      where: { id: In(locationIds), companyId, type: LocationType.WAREHOUSE, status: RecordStatus.ACTIVE },
    });
    const byId = new Map(warehouses.map((warehouse) => [warehouse.id, warehouse]));

    const result = new Map<string, Location>();
    for (const sourceId of sourceIds) {
      const at = locationOf(sourceId);
      const warehouse = at ? byId.get(at) : undefined;
      if (warehouse) result.set(sourceId, warehouse);
    }
    return result;
  }

  private async notifyAdmins(manager: EntityManager, companyId: string, storeId: string, origin: BinOrigin, total: Decimal, actorId: string): Promise<void> {
    const store = await manager.getRepository(Location).findOneBy({ id: storeId });
    await this.notifications.notify(manager, {
      companyId,
      type: NotificationType.RETURNS_BIN_ADDED,
      recipientIds: await this.notifications.findCompanyAdminIds(manager, companyId),
      actorId,
      entityType: NotificationEntityType.RETURNS_BIN,
      entityId: storeId,
      locationId: storeId,
      reference: origin.number,
      quantity: total.toFixed(0),
      locationName: store?.name ?? null,
    });
  }
}
