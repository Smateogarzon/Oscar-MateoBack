import { ConflictException, Injectable } from '@nestjs/common';
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
import { NotificationEntityType } from '../notification/entities/notification-entity-type.enum.js';
import { NotificationType } from '../notification/entities/notification-type.enum.js';
import { NotificationService } from '../notification/notification.service.js';

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

  // Toma del cajón de `storeId` estas cantidades (lo más viejo primero) para mandarlas a bodega: suelta
  // esas reservas —quien las tome las vuelve a apartar a su nombre en la misma transacción— y devuelve
  // de qué documentos salieron. Si el cajón no tiene tanto, no toma nada.
  async take(manager: EntityManager, companyId: string, storeId: string, quantities: BinQuantities): Promise<string[]> {
    const stock = await this.inventoryLocations.findStockLocation(manager, companyId, storeId);
    const repo = manager.getRepository(InventoryReservation);
    const rows = await repo.find({
      where: { sourceType: InventorySourceType.RETURNS_BIN, inventoryLocationId: stock.id, productVariantId: In([...quantities.keys()]) },
      order: { createdAt: 'ASC' },
      lock: { mode: 'pessimistic_write' },
    });
    const origins = new Set<string>();
    for (const [productVariantId, wanted] of quantities) {
      let pending = wanted;
      for (const row of rows.filter((candidate) => candidate.productVariantId === productVariantId)) {
        if (pending.lessThanOrEqualTo(0)) break;
        const taken = Decimal.min(pending, row.quantity);
        pending = pending.minus(taken);
        if (row.sourceNumber) origins.add(row.sourceNumber);
        // Una reserva no se edita: se borra y, si sobra, queda una nueva con lo que sigue en el cajón.
        await repo.remove(row);
        const left = row.quantity.minus(taken);
        if (left.greaterThan(0)) {
          await repo.save(
            repo.create({
              productVariantId: row.productVariantId,
              inventoryLocationId: row.inventoryLocationId,
              quantity: left,
              sourceType: row.sourceType,
              sourceId: row.sourceId,
              sourceNumber: row.sourceNumber,
              reservedBy: row.reservedBy,
            }),
          );
        }
      }
      if (pending.greaterThan(0)) throw new ConflictException('El cajón de devoluciones ya no tiene esas cantidades: vuelve a cargarlo');
    }
    return [...origins];
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
