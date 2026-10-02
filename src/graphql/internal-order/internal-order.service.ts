import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Decimal } from 'decimal.js';
import { DataSource, EntityManager, Repository } from 'typeorm';
import { IncidentStatus } from '../incident/entities/incident-status.enum.js';
import { IncidentType } from '../incident/entities/incident-type.enum.js';
import { Incident } from '../incident/entities/incident.entity.js';
import { InventorySide } from '../inventory-balance/entities/inventory-side.enum.js';
import { InventoryLocationService } from '../inventory-location/inventory-location.service.js';
import { InventoryMovementType } from '../inventory-movement/entities/inventory-movement-type.enum.js';
import { InventorySourceType } from '../inventory-movement/entities/inventory-source-type.enum.js';
import { InventoryMovementService } from '../inventory-movement/inventory-movement.service.js';
import { runIdempotent } from '../idempotency/idempotency.js';
import { Location } from '../location/entities/location.entity.js';
import { DocumentSequenceService } from '../document-sequence/document-sequence.service.js';
import { ProductVariant } from '../product-variant/entities/product-variant.entity.js';
import { InternalOrderItemFoundInput } from './dto/internal-order-item-found.input.js';
import { InternalOrderItemInput } from './dto/internal-order-item.input.js';
import { RequestInternalOrderInput } from './dto/request-internal-order.input.js';
import { InternalOrderItem } from './entities/internal-order-item.entity.js';
import { InternalOrderStatus } from './entities/internal-order-status.enum.js';
import { InternalOrderType } from './entities/internal-order-type.enum.js';
import { InternalOrder } from './entities/internal-order.entity.js';
import { formatInternalOrderNumber, INTERNAL_ORDER_SERIES } from './internal-order-number.js';

export interface InternalOrderFilter {
  status?: InternalOrderStatus;
  type?: InternalOrderType;
  runnerId?: string;
}

const CLOSED_STATUSES = [InternalOrderStatus.COMPLETED, InternalOrderStatus.CANCELLED] as InternalOrderStatus[];

// Un pedido interno: bodega → corredor → destino (ver internal-order-status.enum.ts para el
// recorrido completo, confirmado con el usuario el 2026-10-01). Cada paso exige el permiso de
// quien lo hace, ya sembrado desde el catálogo original (orders.*/warehouse.*/runner.*).
@Injectable()
export class InternalOrderService {
  constructor(
    @InjectRepository(InternalOrder)
    private readonly internalOrderRepository: Repository<InternalOrder>,
    private readonly dataSource: DataSource,
    private readonly sequences: DocumentSequenceService,
    private readonly inventoryMovements: InventoryMovementService,
    private readonly inventoryLocations: InventoryLocationService,
  ) {}

  findAll(companyId: string, filter: InternalOrderFilter = {}): Promise<InternalOrder[]> {
    return this.internalOrderRepository.find({
      where: {
        companyId,
        ...(filter.status && { status: filter.status }),
        ...(filter.type && { type: filter.type }),
        ...(filter.runnerId && { runnerId: filter.runnerId }),
      },
      order: { createdAt: 'DESC' },
    });
  }

  async findOne(companyId: string, id: string): Promise<InternalOrder> {
    const internalOrder = await this.internalOrderRepository.findOneBy({ id, companyId });
    if (!internalOrder) throw new NotFoundException(`Pedido ${id} no encontrado`);
    return internalOrder;
  }

  findItems(companyId: string, internalOrderId: string): Promise<InternalOrderItem[]> {
    return this.findOne(companyId, internalOrderId).then((internalOrder) =>
      this.dataSource.manager.find(InternalOrderItem, {
        where: { internalOrderId: internalOrder.id },
        order: { createdAt: 'ASC' },
      }),
    );
  }

  // Las que están READY y nadie ha tomado: la lista de la que un corredor elige (ver claimAsRunner).
  findAvailableForRunners(companyId: string): Promise<InternalOrder[]> {
    return this.internalOrderRepository.find({
      where: { companyId, status: InternalOrderStatus.READY },
      order: { readyAt: 'ASC' },
    });
  }

  async request(
    companyId: string,
    userId: string,
    input: RequestInternalOrderInput,
    idempotencyKey?: string,
  ): Promise<InternalOrder> {
    this.assertHasOriginOrDestination(input.sourceLocationId, input.destinationLocationId);

    return this.dataSource.transaction((manager) =>
      runIdempotent(
        manager,
        {
          companyId,
          userId,
          operation: 'requestInternalOrder',
          key: idempotencyKey,
          input,
          resourceType: 'internalOrder',
        },
        async () => {
          if (input.sourceLocationId) await this.assertLocation(manager, companyId, input.sourceLocationId);
          if (input.destinationLocationId) await this.assertLocation(manager, companyId, input.destinationLocationId);
          for (const item of input.items) await this.assertProductVariant(manager, companyId, item.productVariantId);

          const number = await this.sequences.next(manager, companyId, INTERNAL_ORDER_SERIES);
          const internalOrder = await this.createVersion(manager, {
            companyId,
            orderNumber: formatInternalOrderNumber(number),
            versionNumber: 1,
            type: input.type,
            origin: input.origin,
            sourceLocationId: input.sourceLocationId ?? null,
            destinationLocationId: input.destinationLocationId ?? null,
            requestedBy: userId,
            notes: input.notes?.trim() || null,
          });
          await this.saveItems(manager, internalOrder.id, input.items);
          return internalOrder;
        },
        (id) => manager.getRepository(InternalOrder).findOneByOrFail({ id }),
      ),
    );
  }

  async accept(companyId: string, userId: string, id: string): Promise<InternalOrder> {
    await this.findOne(companyId, id);
    return this.dataSource.transaction(async (manager) => {
      const internalOrder = await this.lock(manager, companyId, id);
      this.assertStatus(internalOrder, InternalOrderStatus.PENDING, 'aceptar');
      internalOrder.status = InternalOrderStatus.ACCEPTED;
      internalOrder.warehouseOperatorId = userId;
      internalOrder.warehouseAcceptedAt = new Date();
      return manager.getRepository(InternalOrder).save(internalOrder);
    });
  }

  async startPreparing(companyId: string, id: string): Promise<InternalOrder> {
    await this.findOne(companyId, id);
    return this.dataSource.transaction(async (manager) => {
      const internalOrder = await this.lock(manager, companyId, id);
      this.assertStatus(internalOrder, InternalOrderStatus.ACCEPTED, 'empezar a alistar');
      internalOrder.status = InternalOrderStatus.PREPARING;
      internalOrder.packingStartedAt = new Date();
      return manager.getRepository(InternalOrder).save(internalOrder);
    });
  }

  // Deja el pedido listo para transportar. `found` trae, por línea, lo que de verdad se encontró;
  // si es menos de lo pedido, nace una novedad (INSUFFICIENT_STOCK) enlazada a esa línea, para que
  // quede registrada sin bloquear el resto del pedido.
  async markReady(
    companyId: string,
    userId: string,
    id: string,
    found: InternalOrderItemFoundInput[],
  ): Promise<InternalOrder> {
    await this.findOne(companyId, id);
    return this.dataSource.transaction(async (manager) => {
      const internalOrder = await this.lock(manager, companyId, id);
      this.assertStatus(internalOrder, InternalOrderStatus.PREPARING, 'dejar lista');

      const itemRepo = manager.getRepository(InternalOrderItem);
      const items = await itemRepo.find({ where: { internalOrderId: internalOrder.id } });
      const itemsById = new Map(items.map((item) => [item.id, item]));

      for (const line of found) {
        const item = itemsById.get(line.itemId);
        if (!item) throw new NotFoundException(`Línea ${line.itemId} no encontrada en este pedido`);

        const foundQuantity = new Decimal(line.foundQuantity);
        item.foundQuantity = foundQuantity;
        if (foundQuantity.lessThan(item.quantity)) {
          const incident = await manager.getRepository(Incident).save(
            manager.getRepository(Incident).create({
              companyId,
              type: IncidentType.INSUFFICIENT_STOCK,
              status: IncidentStatus.OPEN,
              title: `Faltante en el pedido ${internalOrder.orderNumber}`,
              description: `Se pidieron ${item.quantity.toFixed(2)} y se encontraron ${foundQuantity.toFixed(2)}`,
              entityType: 'INTERNAL_ORDER_ITEM',
              entityId: item.id,
              locationId: internalOrder.sourceLocationId,
              productVariantId: item.productVariantId,
              reportedBy: userId,
              resolvedBy: null,
              resolvedAt: null,
            }),
          );
          item.incidentId = incident.id;
        }
        await itemRepo.save(item);
      }

      internalOrder.status = InternalOrderStatus.READY;
      internalOrder.readyAt = new Date();
      return manager.getRepository(InternalOrder).save(internalOrder);
    });
  }

  // El corredor se asigna a sí mismo el pedido que elige, de entre los READY: no hay despachador.
  async claimAsRunner(companyId: string, userId: string, id: string): Promise<InternalOrder> {
    await this.findOne(companyId, id);
    return this.dataSource.transaction(async (manager) => {
      const internalOrder = await this.lock(manager, companyId, id);
      this.assertStatus(internalOrder, InternalOrderStatus.READY, 'tomar');
      internalOrder.status = InternalOrderStatus.RUNNER_ASSIGNED;
      internalOrder.runnerId = userId;
      internalOrder.runnerAcceptedAt = new Date();
      return manager.getRepository(InternalOrder).save(internalOrder);
    });
  }

  // El corredor ya tiene la mercancía encima: se mueve existencia del STOCK de origen a su propia
  // bolsa (se crea sola la primera vez, ver InventoryLocationService.findOrCreateRunnerLocation).
  async pickUp(companyId: string, userId: string, id: string): Promise<InternalOrder> {
    await this.findOne(companyId, id);
    return this.dataSource.transaction(async (manager) => {
      const internalOrder = await this.lock(manager, companyId, id);
      this.assertStatus(internalOrder, InternalOrderStatus.RUNNER_ASSIGNED, 'recoger');
      this.assertRunner(internalOrder, userId);
      if (!internalOrder.sourceLocationId) {
        throw new ConflictException('Este pedido no tiene una sede de origen: no hay de dónde recoger');
      }

      const sourceStock = await this.inventoryLocations.findStockLocation(manager, companyId, internalOrder.sourceLocationId);
      const runnerBag = await this.inventoryLocations.findOrCreateRunnerLocation(manager, companyId, userId);
      const items = await manager.getRepository(InternalOrderItem).find({ where: { internalOrderId: internalOrder.id } });

      for (const item of items) {
        await this.inventoryMovements.recordInTransaction(manager, companyId, userId, {
          productVariantId: item.productVariantId,
          fromLocationId: sourceStock.id,
          toLocationId: runnerBag.id,
          side: InventorySide.PAIR,
          quantity: item.foundQuantity ?? item.quantity,
          type: InventoryMovementType.RUNNER_PICKUP,
          sourceType: InventorySourceType.TRANSFER_REQUEST,
          sourceId: internalOrder.id,
          sourceNumber: internalOrder.orderNumber,
        });
      }

      internalOrder.status = InternalOrderStatus.IN_TRANSIT;
      internalOrder.runnerPickedUpAt = new Date();
      return manager.getRepository(InternalOrder).save(internalOrder);
    });
  }

  // El corredor dice que entregó: se mueve existencia de su bolsa al STOCK del destino.
  async deliver(companyId: string, userId: string, id: string): Promise<InternalOrder> {
    await this.findOne(companyId, id);
    return this.dataSource.transaction(async (manager) => {
      const internalOrder = await this.lock(manager, companyId, id);
      this.assertStatus(internalOrder, InternalOrderStatus.IN_TRANSIT, 'entregar');
      this.assertRunner(internalOrder, userId);
      if (!internalOrder.destinationLocationId) {
        throw new ConflictException('Este pedido no tiene una sede de destino: no hay a dónde entregar');
      }

      const runnerBag = await this.inventoryLocations.findOrCreateRunnerLocation(manager, companyId, userId);
      const destinationStock = await this.inventoryLocations.findStockLocation(
        manager,
        companyId,
        internalOrder.destinationLocationId,
      );
      const items = await manager.getRepository(InternalOrderItem).find({ where: { internalOrderId: internalOrder.id } });

      for (const item of items) {
        await this.inventoryMovements.recordInTransaction(manager, companyId, userId, {
          productVariantId: item.productVariantId,
          fromLocationId: runnerBag.id,
          toLocationId: destinationStock.id,
          side: InventorySide.PAIR,
          quantity: item.foundQuantity ?? item.quantity,
          type: InventoryMovementType.RUNNER_DELIVERY,
          sourceType: InventorySourceType.TRANSFER_REQUEST,
          sourceId: internalOrder.id,
          sourceNumber: internalOrder.orderNumber,
        });
      }

      internalOrder.status = InternalOrderStatus.DELIVERED;
      internalOrder.deliveredAt = new Date();
      return manager.getRepository(InternalOrder).save(internalOrder);
    });
  }

  // El DESTINO confirma que llegó: un paso aparte de `deliver` (que es la palabra del corredor),
  // para que quede registrado quién lo recibió de verdad.
  async receive(companyId: string, userId: string, id: string): Promise<InternalOrder> {
    await this.findOne(companyId, id);
    return this.dataSource.transaction(async (manager) => {
      const internalOrder = await this.lock(manager, companyId, id);
      this.assertStatus(internalOrder, InternalOrderStatus.DELIVERED, 'recibir');
      internalOrder.status = InternalOrderStatus.RECEIVED;
      internalOrder.receivedAt = new Date();
      internalOrder.receivedBy = userId;
      return manager.getRepository(InternalOrder).save(internalOrder);
    });
  }

  async complete(companyId: string, id: string): Promise<InternalOrder> {
    await this.findOne(companyId, id);
    return this.dataSource.transaction(async (manager) => {
      const internalOrder = await this.lock(manager, companyId, id);
      this.assertStatus(internalOrder, InternalOrderStatus.RECEIVED, 'cerrar');
      internalOrder.status = InternalOrderStatus.COMPLETED;
      internalOrder.completedAt = new Date();
      return manager.getRepository(InternalOrder).save(internalOrder);
    });
  }

  // Quien lo pidió, o quien alista pedidos en bodega, pueden cancelarlo mientras no esté cerrado.
  async cancel(
    companyId: string,
    actor: { userId: string; canFulfillOrders: boolean },
    id: string,
    reason?: string,
  ): Promise<InternalOrder> {
    await this.findOne(companyId, id);
    return this.dataSource.transaction(async (manager) => {
      const internalOrder = await this.lock(manager, companyId, id);
      if (CLOSED_STATUSES.includes(internalOrder.status)) {
        throw new ConflictException('Este pedido ya se cerró');
      }
      const isRequester = internalOrder.requestedBy === actor.userId;
      if (!isRequester && !actor.canFulfillOrders) {
        throw new ForbiddenException('Solo quien lo pidió, o quien alista pedidos en bodega, puede cancelarlo');
      }
      internalOrder.status = InternalOrderStatus.CANCELLED;
      internalOrder.cancelledAt = new Date();
      internalOrder.cancelledBy = actor.userId;
      internalOrder.cancellationReason = reason?.trim() || null;
      return manager.getRepository(InternalOrder).save(internalOrder);
    });
  }

  // Cambiar las líneas de un pedido que todavía nadie tocó (PENDING) se hace en el sitio. Uno que
  // bodega ya aceptó se guarda como una versión nueva (mismo orderNumber, versionNumber+1), para no
  // perder lo que ya se había registrado contra la versión anterior — ver la entidad.
  async updateItems(
    companyId: string,
    userId: string,
    id: string,
    items: InternalOrderItemInput[],
  ): Promise<InternalOrder> {
    await this.findOne(companyId, id);
    return this.dataSource.transaction(async (manager) => {
      const current = await this.lock(manager, companyId, id);
      if (CLOSED_STATUSES.includes(current.status)) {
        throw new ConflictException('Este pedido ya se cerró: no se le pueden cambiar las líneas');
      }
      for (const item of items) await this.assertProductVariant(manager, companyId, item.productVariantId);

      if (current.status === InternalOrderStatus.PENDING) {
        await manager.getRepository(InternalOrderItem).delete({ internalOrderId: current.id });
        await this.saveItems(manager, current.id, items);
        return current;
      }

      const nextVersion = current.versionNumber + 1;
      current.status = InternalOrderStatus.CANCELLED;
      current.cancelledAt = new Date();
      current.cancelledBy = userId;
      current.cancellationReason = `Reemplazada por la versión ${nextVersion}`;
      await manager.getRepository(InternalOrder).save(current);

      const revised = await this.createVersion(manager, {
        companyId,
        orderNumber: current.orderNumber,
        versionNumber: nextVersion,
        type: current.type,
        origin: current.origin,
        sourceLocationId: current.sourceLocationId,
        destinationLocationId: current.destinationLocationId,
        requestedBy: current.requestedBy,
        notes: current.notes,
      });
      await this.saveItems(manager, revised.id, items);
      return revised;
    });
  }

  private async createVersion(
    manager: EntityManager,
    data: {
      companyId: string;
      orderNumber: string;
      versionNumber: number;
      type: InternalOrderType;
      origin: InternalOrder['origin'];
      sourceLocationId: string | null;
      destinationLocationId: string | null;
      requestedBy: string | null;
      notes: string | null;
    },
  ): Promise<InternalOrder> {
    const repo = manager.getRepository(InternalOrder);
    // Explícito y no el default de la columna: una versión (como un pedido nuevo) siempre nace
    // PENDING, para no depender de qué devuelva el INSERT antes de releerla.
    return repo.save(repo.create({ ...data, status: InternalOrderStatus.PENDING }));
  }

  private async saveItems(
    manager: EntityManager,
    internalOrderId: string,
    items: InternalOrderItemInput[],
  ): Promise<void> {
    const itemRepo = manager.getRepository(InternalOrderItem);
    await itemRepo.save(
      items.map((item) =>
        itemRepo.create({
          internalOrderId,
          productVariantId: item.productVariantId,
          quantity: new Decimal(item.quantity),
          foundQuantity: null,
          incidentId: null,
          unitPrice: item.unitPrice ? new Decimal(item.unitPrice) : null,
          discountAmount: new Decimal(item.discountAmount ?? '0'),
          notes: item.notes?.trim() || null,
        }),
      ),
    );
  }

  private assertHasOriginOrDestination(sourceLocationId?: string, destinationLocationId?: string): void {
    if (!sourceLocationId && !destinationLocationId) {
      throw new BadRequestException('Un pedido necesita al menos una sede de origen o de destino');
    }
  }

  private assertStatus(internalOrder: InternalOrder, expected: InternalOrderStatus, action: string): void {
    if (internalOrder.status !== expected) {
      throw new ConflictException(`Solo se puede ${action} un pedido en estado ${expected}`);
    }
  }

  private assertRunner(internalOrder: InternalOrder, userId: string): void {
    if (internalOrder.runnerId !== userId) {
      throw new ForbiddenException('Solo el corredor asignado a este pedido puede hacer esto');
    }
  }

  private async lock(manager: EntityManager, companyId: string, id: string): Promise<InternalOrder> {
    const internalOrder = await manager
      .getRepository(InternalOrder)
      .findOne({ where: { id, companyId }, lock: { mode: 'pessimistic_write' } });
    if (!internalOrder) throw new NotFoundException(`Pedido ${id} no encontrado`);
    return internalOrder;
  }

  private async assertLocation(manager: EntityManager, companyId: string, locationId: string): Promise<void> {
    const exists = await manager.getRepository(Location).existsBy({ id: locationId, companyId });
    if (!exists) throw new NotFoundException(`Sede ${locationId} no encontrada`);
  }

  private async assertProductVariant(
    manager: EntityManager,
    companyId: string,
    productVariantId: string,
  ): Promise<void> {
    const exists = await manager.getRepository(ProductVariant).existsBy({ id: productVariantId, companyId });
    if (!exists) throw new NotFoundException(`Variante ${productVariantId} no encontrada`);
  }
}
