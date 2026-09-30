import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Decimal } from 'decimal.js';
import { DataSource, EntityManager, Repository } from 'typeorm';
import { InventoryBalance } from '../inventory-balance/entities/inventory-balance.entity.js';
import { lockOrCreateInventoryBalance } from '../inventory-balance/lock-inventory-balance.js';
import { InventoryLocation } from '../inventory-location/entities/inventory-location.entity.js';
import { runIdempotent } from '../idempotency/idempotency.js';
import { ProductVariant } from '../product-variant/entities/product-variant.entity.js';
import { CreateInventoryMovementInput } from './dto/create-inventory-movement.input.js';
import { InventoryMovement } from './entities/inventory-movement.entity.js';

export interface InventoryMovementFilter {
  productVariantId?: string;
  fromLocationId?: string;
  toLocationId?: string;
}

// El kárdex (ver la entidad): esta es la ÚNICA puerta para tocar inventory_balances. Se ajusta
// dentro de la MISMA transacción que crea el movimiento, con las filas bloqueadas en un orden fijo
// (por inventoryLocationId), para que dos traspasos en sentido contrario a la vez no se
// interbloqueen ni se pisen (lo que el usuario pidió cuidar expresamente).
@Injectable()
export class InventoryMovementService {
  constructor(
    @InjectRepository(InventoryMovement)
    private readonly inventoryMovementRepository: Repository<InventoryMovement>,
    private readonly dataSource: DataSource,
  ) {}

  findAll(companyId: string, filter: InventoryMovementFilter = {}): Promise<InventoryMovement[]> {
    return this.inventoryMovementRepository.find({
      where: {
        companyId,
        ...(filter.productVariantId && { productVariantId: filter.productVariantId }),
        ...(filter.fromLocationId && { fromLocationId: filter.fromLocationId }),
        ...(filter.toLocationId && { toLocationId: filter.toLocationId }),
      },
      order: { createdAt: 'DESC' },
    });
  }

  async findOne(companyId: string, id: string): Promise<InventoryMovement> {
    const movement = await this.inventoryMovementRepository.findOneBy({ id, companyId });
    if (!movement) throw new NotFoundException(`Movimiento ${id} no encontrado`);
    return movement;
  }

  async record(
    companyId: string,
    userId: string,
    input: CreateInventoryMovementInput,
    idempotencyKey?: string,
  ): Promise<InventoryMovement> {
    if (!input.fromLocationId && !input.toLocationId) {
      throw new BadRequestException('Un movimiento necesita al menos un origen o un destino');
    }
    if (input.fromLocationId && input.fromLocationId === input.toLocationId) {
      throw new BadRequestException('El origen y el destino no pueden ser el mismo');
    }
    const quantity = new Decimal(input.quantity);
    if (quantity.lessThanOrEqualTo(0)) {
      throw new BadRequestException('La cantidad debe ser mayor que cero');
    }

    return this.dataSource.transaction((manager) =>
      runIdempotent(
        manager,
        {
          companyId,
          userId,
          operation: 'recordInventoryMovement',
          key: idempotencyKey,
          input,
          resourceType: 'inventoryMovement',
        },
        async () => {
          await this.assertProductVariant(manager, companyId, input.productVariantId);
          if (input.fromLocationId) await this.assertInventoryLocation(manager, companyId, input.fromLocationId);
          if (input.toLocationId) await this.assertInventoryLocation(manager, companyId, input.toLocationId);

          // Se bloquean las dos balanzas involucradas (si hay dos) siempre en el mismo orden entre
          // sí (por inventoryLocationId), sin importar cuál es origen y cuál destino: así un
          // traspaso A→B y uno B→A a la vez nunca se interbloquean.
          const locationIds = [...new Set([input.fromLocationId, input.toLocationId].filter(Boolean))].sort() as string[];
          const balances = new Map<string, InventoryBalance>();
          for (const locationId of locationIds) {
            balances.set(
              locationId,
              await lockOrCreateInventoryBalance(manager, input.productVariantId, locationId, input.side),
            );
          }

          if (input.fromLocationId) {
            const fromBalance = balances.get(input.fromLocationId)!;
            if (fromBalance.quantity.lessThan(quantity)) {
              throw new ConflictException(
                `No hay suficiente existencia: hay ${fromBalance.quantity.toFixed(2)} y se pidieron ${quantity.toFixed(2)}`,
              );
            }
            await this.adjustBalance(manager, fromBalance, quantity.negated());
          }
          if (input.toLocationId) {
            const toBalance = balances.get(input.toLocationId)!;
            await this.adjustBalance(manager, toBalance, quantity, input.position, input.minStock);
          }

          const repo = manager.getRepository(InventoryMovement);
          return repo.save(
            repo.create({
              companyId,
              productVariantId: input.productVariantId,
              fromLocationId: input.fromLocationId ?? null,
              toLocationId: input.toLocationId ?? null,
              side: input.side,
              quantity,
              type: input.type,
              sourceType: input.sourceType,
              sourceId: input.sourceId ?? null,
              sourceNumber: input.sourceNumber?.trim() || null,
              notes: input.notes?.trim() || null,
              createdBy: userId,
            }),
          );
        },
        (id) => manager.getRepository(InventoryMovement).findOneByOrFail({ id }),
      ),
    );
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

  // `position` y `minStock` solo se le ponen a la balanza de destino (ver la llamada): la de
  // origen se está vaciando, no tiene sentido reubicarla ni fijarle un mínimo. Ausentes no tocan
  // lo que ya tenían; "" los borra (ver el input).
  private async adjustBalance(manager: EntityManager, balance: InventoryBalance, delta: Decimal, position?: string, minStock?: string): Promise<void> {
    balance.quantity = balance.quantity.plus(delta);
    if (position !== undefined) balance.position = position || null;
    if (minStock !== undefined) balance.minStock = minStock ? new Decimal(minStock) : null;
    await manager.getRepository(InventoryBalance).save(balance);
  }
}
