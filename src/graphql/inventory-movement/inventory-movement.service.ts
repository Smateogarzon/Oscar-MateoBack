import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Decimal } from 'decimal.js';
import { DataSource, EntityManager, Repository } from 'typeorm';
import { PermissionCode } from '../../common/enums/permission-code.enum.js';
import { InventoryBalance } from '../inventory-balance/entities/inventory-balance.entity.js';
import { lockOrCreateInventoryBalance } from '../inventory-balance/lock-inventory-balance.js';
import type { InventorySide } from '../inventory-balance/entities/inventory-side.enum.js';
import { InventoryLocation } from '../inventory-location/entities/inventory-location.entity.js';
import { runIdempotent } from '../idempotency/idempotency.js';
import { NotificationEntityType } from '../notification/entities/notification-entity-type.enum.js';
import { NotificationType } from '../notification/entities/notification-type.enum.js';
import { NotificationService } from '../notification/notification.service.js';
import { ProductVariant } from '../product-variant/entities/product-variant.entity.js';
import { CreateInventoryMovementInput } from './dto/create-inventory-movement.input.js';
import { InventoryMovement } from './entities/inventory-movement.entity.js';
import type { InventoryMovementType } from './entities/inventory-movement-type.enum.js';
import type { InventorySourceType } from './entities/inventory-source-type.enum.js';

export interface InventoryMovementFilter {
  productVariantId?: string;
  fromLocationId?: string;
  toLocationId?: string;
}

// Lo mismo que `CreateInventoryMovementInput`, pero con `quantity` ya convertida a Decimal: lo usa
// `recordInTransaction`, para quien ya la tiene como Decimal (una línea de venta) y no quiere ir y
// volver a texto solo para que el servicio la vuelva a convertir.
export interface RecordMovementParams {
  productVariantId: string;
  fromLocationId?: string | null;
  toLocationId?: string | null;
  side: InventorySide;
  quantity: Decimal;
  type: InventoryMovementType;
  sourceType: InventorySourceType;
  sourceId?: string | null;
  sourceNumber?: string | null;
  notes?: string | null;
  position?: string;
  minStock?: string;
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
    private readonly notifications: NotificationService,
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
        () =>
          this.recordInTransaction(manager, companyId, userId, {
            productVariantId: input.productVariantId,
            fromLocationId: input.fromLocationId,
            toLocationId: input.toLocationId,
            side: input.side,
            quantity: new Decimal(input.quantity),
            type: input.type,
            sourceType: input.sourceType,
            sourceId: input.sourceId,
            sourceNumber: input.sourceNumber,
            notes: input.notes,
            position: input.position,
            minStock: input.minStock,
          }),
        (id) => manager.getRepository(InventoryMovement).findOneByOrFail({ id }),
      ),
    );
  }

  // El cuerpo de `record`, para quien ya está dentro de una transacción propia (como
  // `SalePaymentService.complete`, que descuenta existencia y cobra la venta en una sola unidad
  // atómica: o se guarda todo, o no se guarda nada). `record` lo usa también, con su propia
  // transacción. No lleva idempotencia propia: la pone quien lo llame.
  async recordInTransaction(
    manager: EntityManager,
    companyId: string,
    userId: string,
    params: RecordMovementParams,
  ): Promise<InventoryMovement> {
    if (!params.fromLocationId && !params.toLocationId) {
      throw new BadRequestException('Un movimiento necesita al menos un origen o un destino');
    }
    if (params.fromLocationId && params.fromLocationId === params.toLocationId) {
      throw new BadRequestException('El origen y el destino no pueden ser el mismo');
    }
    if (params.quantity.lessThanOrEqualTo(0)) {
      throw new BadRequestException('La cantidad debe ser mayor que cero');
    }

    await this.assertProductVariant(manager, companyId, params.productVariantId);
    if (params.fromLocationId) await this.assertInventoryLocation(manager, companyId, params.fromLocationId);
    if (params.toLocationId) await this.assertInventoryLocation(manager, companyId, params.toLocationId);

    // Se bloquean las dos balanzas involucradas (si hay dos) siempre en el mismo orden entre sí
    // (por inventoryLocationId), sin importar cuál es origen y cuál destino: así un traspaso A→B y
    // uno B→A a la vez nunca se interbloquean.
    const locationIds = [...new Set([params.fromLocationId, params.toLocationId].filter(Boolean))].sort() as string[];
    const balances = new Map<string, InventoryBalance>();
    for (const locationId of locationIds) {
      balances.set(locationId, await lockOrCreateInventoryBalance(manager, params.productVariantId, locationId, params.side));
    }

    if (params.fromLocationId) {
      const fromBalance = balances.get(params.fromLocationId)!;
      if (fromBalance.quantity.lessThan(params.quantity)) {
        throw new ConflictException(
          `No hay suficiente existencia: hay ${fromBalance.quantity.toFixed(2)} y se pidieron ${params.quantity.toFixed(2)}`,
        );
      }
      const beforeQuantity = fromBalance.quantity;
      await this.adjustBalance(manager, fromBalance, params.quantity.negated());
      await this.maybeNotifyLowStock(manager, companyId, userId, fromBalance, beforeQuantity);
    }
    if (params.toLocationId) {
      const toBalance = balances.get(params.toLocationId)!;
      await this.adjustBalance(manager, toBalance, params.quantity, params.position, params.minStock);
    }

    const repo = manager.getRepository(InventoryMovement);
    return repo.save(
      repo.create({
        companyId,
        productVariantId: params.productVariantId,
        fromLocationId: params.fromLocationId ?? null,
        toLocationId: params.toLocationId ?? null,
        side: params.side,
        quantity: params.quantity,
        type: params.type,
        sourceType: params.sourceType,
        sourceId: params.sourceId ?? null,
        sourceNumber: params.sourceNumber?.trim() || null,
        notes: params.notes?.trim() || null,
        createdBy: userId,
      }),
    );
  }

  // Avisa a quien administra inventario cuando una existencia ACABA de cruzar su mínimo (ver
  // InventoryBalance.minStock): solo en el movimiento que la deja en o por debajo viniendo de
  // arriba, no en los siguientes mientras siga baja (si no, cada venta mientras está agotada
  // mandaría otro aviso). Sin mínimo puesto en esa balanza, no hay con qué comparar y no se avisa.
  private async maybeNotifyLowStock(
    manager: EntityManager,
    companyId: string,
    actorId: string,
    balance: InventoryBalance,
    beforeQuantity: Decimal,
  ): Promise<void> {
    const threshold = balance.minStock;
    if (!threshold) return;
    const justCrossed = beforeQuantity.greaterThan(threshold) && balance.quantity.lessThanOrEqualTo(threshold);
    if (!justCrossed) return;

    const recipientIds = await this.notifications.findUserIdsWithPermission(manager, companyId, PermissionCode.INVENTORY_MANAGE_PRODUCTS);
    if (recipientIds.length === 0) return;

    const [variant, location] = await Promise.all([
      manager.getRepository(ProductVariant).findOne({ where: { id: balance.productVariantId }, relations: { product: true } }),
      manager.getRepository(InventoryLocation).findOne({ where: { id: balance.inventoryLocationId }, relations: { location: true } }),
    ]);
    if (!variant || !location) return;

    await this.notifications.notify(manager, {
      companyId,
      type: NotificationType.INVENTORY_LOW_STOCK,
      recipientIds,
      actorId,
      entityType: NotificationEntityType.INVENTORY_BALANCE,
      entityId: balance.id,
      locationId: location.locationId,
      reference: `${variant.product.name} (${variant.sku})`,
      quantity: balance.quantity.toFixed(2),
      minStock: threshold.toFixed(2),
      locationName: location.location?.name ?? null,
      outOfStock: balance.quantity.lessThanOrEqualTo(0),
    });
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
