import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Decimal } from 'decimal.js';
import { DataSource, EntityManager, Repository } from 'typeorm';
import { lockOrCreateInventoryBalance } from '../inventory-balance/lock-inventory-balance.js';
import { InventoryLocation } from '../inventory-location/entities/inventory-location.entity.js';
import { InventorySourceType } from '../inventory-movement/entities/inventory-source-type.enum.js';
import { runIdempotent } from '../idempotency/idempotency.js';
import { ProductVariant } from '../product-variant/entities/product-variant.entity.js';
import { CreateInventoryReservationInput } from './dto/create-inventory-reservation.input.js';
import { InventoryReservation } from './entities/inventory-reservation.entity.js';

export interface InventoryReservationFilter {
  productVariantId?: string;
  inventoryLocationId?: string;
}

// Aparta existencia sin moverla (ver la entidad). Se bloquea la MISMA balanza que ajustan los
// movimientos (lockOrCreateInventoryBalance): así una reserva y un movimiento sobre la misma
// existencia, a la vez, nunca se pisan ni prometen lo mismo dos veces.
@Injectable()
export class InventoryReservationService {
  constructor(
    @InjectRepository(InventoryReservation)
    private readonly inventoryReservationRepository: Repository<InventoryReservation>,
    private readonly dataSource: DataSource,
  ) {}

  findAll(companyId: string, filter: InventoryReservationFilter = {}): Promise<InventoryReservation[]> {
    return this.inventoryReservationRepository.find({
      where: {
        productVariant: { companyId },
        ...(filter.productVariantId && { productVariantId: filter.productVariantId }),
        ...(filter.inventoryLocationId && { inventoryLocationId: filter.inventoryLocationId }),
      },
      order: { createdAt: 'ASC' },
    });
  }

  async findOne(companyId: string, id: string): Promise<InventoryReservation> {
    const reservation = await this.inventoryReservationRepository.findOne({
      where: { id, productVariant: { companyId } },
    });
    if (!reservation) throw new NotFoundException(`Reserva ${id} no encontrada`);
    return reservation;
  }

  async create(
    companyId: string,
    userId: string,
    input: CreateInventoryReservationInput,
    idempotencyKey?: string,
  ): Promise<InventoryReservation> {
    const quantity = new Decimal(input.quantity);
    if (quantity.lessThanOrEqualTo(0)) {
      throw new BadRequestException('La cantidad debe ser mayor que cero');
    }
    if (!input.sourceId && input.sourceType !== InventorySourceType.MANUAL_ADJUSTMENT) {
      throw new BadRequestException('Una reserva que nace de un documento debe indicar sourceId');
    }

    return this.dataSource.transaction((manager) =>
      runIdempotent(
        manager,
        {
          companyId,
          userId,
          operation: 'createInventoryReservation',
          key: idempotencyKey,
          input,
          resourceType: 'inventoryReservation',
        },
        async () => {
          await this.assertProductVariant(manager, companyId, input.productVariantId);
          await this.assertInventoryLocation(manager, companyId, input.inventoryLocationId);

          // Bloquea la balanza antes de leer nada: dos reservas a la vez sobre la misma existencia
          // se hacen una después de la otra, nunca las dos contra el mismo "disponible".
          const balance = await lockOrCreateInventoryBalance(
            manager,
            input.productVariantId,
            input.inventoryLocationId,
            input.side,
          );
          const alreadyReserved = await this.reservedQuantity(
            manager,
            input.productVariantId,
            input.inventoryLocationId,
            input.side,
          );
          const available = balance.quantity.minus(alreadyReserved);
          if (available.lessThan(quantity)) {
            throw new ConflictException(
              `No hay suficiente existencia disponible: hay ${available.toFixed(2)} (de ${balance.quantity.toFixed(2)} ya hay ${alreadyReserved.toFixed(2)} reservados) y se pidieron ${quantity.toFixed(2)}`,
            );
          }

          const repo = manager.getRepository(InventoryReservation);
          return repo.save(
            repo.create({
              productVariantId: input.productVariantId,
              inventoryLocationId: input.inventoryLocationId,
              side: input.side,
              quantity,
              sourceType: input.sourceType,
              sourceId: input.sourceId ?? null,
              sourceNumber: input.sourceNumber?.trim() || null,
            }),
          );
        },
        (id) => manager.getRepository(InventoryReservation).findOneByOrFail({ id }),
      ),
    );
  }

  // Libera lo apartado: se borra, no se edita (no hay un estado "liberada"; ver la entidad).
  async release(companyId: string, id: string): Promise<void> {
    await this.findOne(companyId, id);
    await this.inventoryReservationRepository.delete(id);
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

  private async reservedQuantity(
    manager: EntityManager,
    productVariantId: string,
    inventoryLocationId: string,
    side: string,
  ): Promise<Decimal> {
    const rows: { sum: string | null }[] = await manager.query(
      `SELECT COALESCE(SUM("quantity"), 0)::text AS sum FROM "inventory_reservations"
       WHERE "productVariantId" = $1 AND "inventoryLocationId" = $2 AND "side" = $3`,
      [productVariantId, inventoryLocationId, side],
    );
    return new Decimal(rows[0]?.sum ?? '0');
  }
}
