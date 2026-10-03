import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Decimal } from 'decimal.js';
import { EntityManager, Repository } from 'typeorm';
import { InventoryBalanceService } from '../inventory-balance/inventory-balance.service.js';
import { lockOrCreateInventoryBalance } from '../inventory-balance/lock-inventory-balance.js';
import { InventoryLocation } from '../inventory-location/entities/inventory-location.entity.js';
import { InventorySourceType } from '../inventory-movement/entities/inventory-source-type.enum.js';
import { ProductVariant } from '../product-variant/entities/product-variant.entity.js';
import { InventoryReservation } from './entities/inventory-reservation.entity.js';
import { reservedQuantity } from './reserved-quantity.js';

export interface InventoryReservationFilter {
  productVariantId?: string;
  inventoryLocationId?: string;
}

// Lo que hace falta para apartar algo, con `quantity` ya como Decimal: lo usa quien ya la tiene así
// (una línea de venta) y no quiere ir y volver a texto solo para que el servicio la vuelva a convertir.
export interface ReserveParams {
  productVariantId: string;
  inventoryLocationId: string;
  quantity: Decimal;
  sourceType: InventorySourceType;
  sourceId?: string | null;
  sourceNumber?: string | null;
  reservedBy?: string | null;
}

// El documento que aparta, y de parte de quién.
export interface ReservationSourceInfo {
  sourceType: InventorySourceType;
  sourceId: string;
  sourceNumber?: string | null;
  reservedBy: string;
}

// Aparta existencia sin moverla (ver la entidad). Se bloquea la MISMA balanza que ajustan los
// movimientos (lockOrCreateInventoryBalance): así una reserva y un movimiento sobre la misma
// existencia, a la vez, nunca se pisan ni prometen lo mismo dos veces.
@Injectable()
export class InventoryReservationService {
  constructor(
    @InjectRepository(InventoryReservation)
    private readonly inventoryReservationRepository: Repository<InventoryReservation>,
    private readonly balances: InventoryBalanceService,
  ) {}

  findAll(companyId: string, filter: InventoryReservationFilter = {}): Promise<InventoryReservation[]> {
    return this.inventoryReservationRepository.find({
      where: {
        productVariant: { companyId },
        ...(filter.productVariantId && { productVariantId: filter.productVariantId }),
        ...(filter.inventoryLocationId && { inventoryLocationId: filter.inventoryLocationId }),
      },
      // Con quién la tiene apartada: es lo que el otro vendedor necesita saber para ir a hablar con él.
      relations: { reservedByUser: true },
      order: { createdAt: 'ASC' },
    });
  }

  async findOne(companyId: string, id: string): Promise<InventoryReservation> {
    const reservation = await this.inventoryReservationRepository.findOne({
      where: { id, productVariant: { companyId } },
      relations: { reservedByUser: true },
    });
    if (!reservation) throw new NotFoundException(`Reserva ${id} no encontrada`);
    return reservation;
  }

  // Aparta unidades dentro de la transacción de quien llama (una venta que agrega una línea y la
  // aparta en la misma unidad atómica: si una falla, no queda ni la línea ni lo apartado). Sin
  // idempotencia propia: la pone quien llame.
  async reserveInTransaction(
    manager: EntityManager,
    companyId: string,
    params: ReserveParams,
  ): Promise<InventoryReservation> {
    await this.assertProductVariant(manager, companyId, params.productVariantId);
    await this.assertInventoryLocation(manager, companyId, params.inventoryLocationId);

    // Bloquea la balanza antes de leer nada: dos reservas a la vez sobre la misma existencia
    // se hacen una después de la otra, nunca las dos contra el mismo "disponible".
    const balance = await lockOrCreateInventoryBalance(
      manager,
      params.productVariantId,
      params.inventoryLocationId,
    );
    const alreadyReserved = await reservedQuantity(
      manager,
      params.productVariantId,
      params.inventoryLocationId,
    );
    const available = balance.quantity.minus(alreadyReserved);
    if (available.lessThan(params.quantity)) {
      throw new ConflictException(
        `No hay suficiente existencia disponible: hay ${available.toFixed(2)} (de ${balance.quantity.toFixed(2)} ya hay ${alreadyReserved.toFixed(2)} reservados) y se pidieron ${params.quantity.toFixed(2)}`,
      );
    }

    const repo = manager.getRepository(InventoryReservation);
    return repo.save(
      repo.create({
        productVariantId: params.productVariantId,
        inventoryLocationId: params.inventoryLocationId,
        quantity: params.quantity,
        sourceType: params.sourceType,
        sourceId: params.sourceId ?? null,
        sourceNumber: params.sourceNumber?.trim() || null,
        reservedBy: params.reservedBy ?? null,
      }),
    );
  }

  // Deja lo apartado por un documento igual a `desired` (variante → cantidad), y nada más: lo que ya
  // no está en el documento se suelta y lo que cambió de cantidad se vuelve a apartar. Se llama cada
  // vez que cambian las líneas de una venta en curso, así lo reservado y lo que se va a cobrar nunca
  // se separan. La bodega la elige `findStockLocationForSale` (la que más disponible tenga).
  async syncForSource(
    manager: EntityManager,
    companyId: string,
    source: ReservationSourceInfo,
    desired: Map<string, Decimal>,
  ): Promise<void> {
    const repo = manager.getRepository(InventoryReservation);
    const existing = await repo.findBy({ sourceType: source.sourceType, sourceId: source.sourceId });
    const pending = new Map(desired);

    const byVariant = new Map<string, InventoryReservation[]>();
    for (const row of existing) {
      byVariant.set(row.productVariantId, [...(byVariant.get(row.productVariantId) ?? []), row]);
    }

    for (const [productVariantId, rows] of byVariant) {
      const wanted = pending.get(productVariantId);
      const held = rows.reduce((sum, row) => sum.plus(row.quantity), new Decimal(0));
      // Ya estaba apartado exactamente eso, en una sola fila: se deja como está, para no soltar y
      // volver a tomar lo mismo (entre las dos cosas otro vendedor podría colarse).
      if (wanted && rows.length === 1 && held.equals(wanted)) {
        pending.delete(productVariantId);
        continue;
      }
      await repo.delete(rows.map((row) => row.id));
    }

    for (const [productVariantId, quantity] of pending) {
      const inventoryLocationId = await this.balances.findStockLocationForSale(
        manager,
        companyId,
        productVariantId,
        quantity,
      );
      await this.reserveInTransaction(manager, companyId, {
        productVariantId,
        inventoryLocationId,
        quantity,
        sourceType: source.sourceType,
        sourceId: source.sourceId,
        sourceNumber: source.sourceNumber,
        reservedBy: source.reservedBy,
      });
    }
  }

  // Lo que aparta un documento, para quien necesita saber de qué bodega salió (al cobrar la venta se
  // descuenta justo de donde se apartó, no de la que más tenga hoy).
  findForSource(
    manager: EntityManager,
    sourceType: InventorySourceType,
    sourceId: string,
  ): Promise<InventoryReservation[]> {
    return manager.getRepository(InventoryReservation).findBy({ sourceType, sourceId });
  }

  private async assertProductVariant(
    manager: EntityManager,
    companyId: string,
    productVariantId: string,
  ): Promise<void> {
    const exists = await manager.getRepository(ProductVariant).existsBy({ id: productVariantId, companyId });
    if (!exists) throw new NotFoundException(`Variante ${productVariantId} no encontrada`);
  }

  private async assertInventoryLocation(
    manager: EntityManager,
    companyId: string,
    inventoryLocationId: string,
  ): Promise<void> {
    const exists = await manager.getRepository(InventoryLocation).existsBy({ id: inventoryLocationId, companyId });
    if (!exists) throw new NotFoundException(`Ubicación de inventario ${inventoryLocationId} no encontrada`);
  }
}
