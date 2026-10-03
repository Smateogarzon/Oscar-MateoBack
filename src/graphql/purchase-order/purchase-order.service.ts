import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Decimal } from 'decimal.js';
import { DataSource, EntityManager, In, Repository } from 'typeorm';
import { DocumentSequenceService } from '../document-sequence/document-sequence.service.js';
import { runIdempotent } from '../idempotency/idempotency.js';
import { IncidentStatus } from '../incident/entities/incident-status.enum.js';
import { Location } from '../location/entities/location.entity.js';
import { LocationType } from '../location/entities/location-type.enum.js';
import { NotificationService } from '../notification/notification.service.js';
import { ProductVariant } from '../product-variant/entities/product-variant.entity.js';
import { CreatePurchaseOrderInput } from './dto/create-purchase-order.input.js';
import { PurchaseOrderItemCountInput } from './dto/purchase-order-item-count.input.js';
import { PurchaseOrderItemInput } from './dto/purchase-order-item.input.js';
import { PurchaseOrderOverageDecisionInput } from './dto/purchase-order-overage-decision.input.js';
import { PurchaseOrderItem } from './entities/purchase-order-item.entity.js';
import { PurchaseOrderStatus } from './entities/purchase-order-status.enum.js';
import { PurchaseOrder } from './entities/purchase-order.entity.js';
import { closeShipmentIncidents } from './purchase-order-incidents.js';
import { loadPurchaseOrderItems } from './purchase-order-lines.js';
import { formatPurchaseOrderNumber, PURCHASE_ORDER_SERIES } from './purchase-order-number.js';
import { PurchaseOrderReceivingService } from './purchase-order-receiving.service.js';
import { clearShipment, overageItems, registerShipment } from './purchase-order-shipping.js';
import { resolveSupplierId } from './purchase-order-supplier.js';
import { signalPurchaseOrderChange } from './purchase-order-watchers.js';
import { purchaseOrderTotals, type PricedLine } from './purchase-order-totals.js';

export interface PurchaseOrderFilter {
  status?: PurchaseOrderStatus;
  supplierId?: string;
}

type PricedItemLine = PricedLine & { productVariantId: string };

// Una orden de compra (ver la entidad). Armarla, enviarla y despacharla no tocan inventario: lo
// que de verdad suma existencia es que el bodeguero la reciba contándola (ver `receive`). Cada paso manda
// una señal en vivo a quienes siguen la orden, para que la empresa y su proveedor se vean
// trabajando sin recargar (ver purchase-order-watchers.ts).
@Injectable()
export class PurchaseOrderService {
  constructor(
    @InjectRepository(PurchaseOrder)
    private readonly purchaseOrderRepository: Repository<PurchaseOrder>,
    private readonly dataSource: DataSource,
    private readonly sequences: DocumentSequenceService,
    private readonly receiving: PurchaseOrderReceivingService,
    private readonly notifications: NotificationService,
  ) {}

  findAll(companyId: string, filter: PurchaseOrderFilter = {}): Promise<PurchaseOrder[]> {
    return this.purchaseOrderRepository.find({
      where: {
        companyId,
        ...(filter.status && { status: filter.status }),
        ...(filter.supplierId && { supplierId: filter.supplierId }),
      },
      order: { createdAt: 'DESC' },
    });
  }

  // `supplierScope` acota la búsqueda a las órdenes de ese proveedor: la de otro no es que esté
  // prohibida, es que para él no existe (404, no 403: así no se entera de cuáles hay).
  async findOne(companyId: string, id: string, supplierScope?: string): Promise<PurchaseOrder> {
    const purchaseOrder = await this.purchaseOrderRepository.findOneBy({
      id,
      companyId,
      ...(supplierScope && { supplierId: supplierScope }),
    });
    if (!purchaseOrder) throw new NotFoundException(`Orden de compra ${id} no encontrada`);
    return purchaseOrder;
  }

  async findItems(
    companyId: string,
    purchaseOrderId: string,
    supplierScope?: string,
  ): Promise<PurchaseOrderItem[]> {
    const purchaseOrder = await this.findOne(companyId, purchaseOrderId, supplierScope);
    return loadPurchaseOrderItems(this.dataSource.manager, purchaseOrder.id);
  }

  async create(
    companyId: string,
    userId: string,
    input: CreatePurchaseOrderInput,
    idempotencyKey?: string,
  ): Promise<PurchaseOrder> {
    return this.dataSource.transaction((manager) =>
      runIdempotent(
        manager,
        {
          companyId,
          userId,
          operation: 'createPurchaseOrder',
          key: idempotencyKey,
          input,
          resourceType: 'purchaseOrder',
        },
        async () => {
          const supplierId = await resolveSupplierId(manager, companyId, input.supplierId);
          await this.assertLocation(manager, companyId, input.destinationLocationId);
          const lines = await this.priceLines(manager, companyId, input.items);
          const { subtotal, total } = purchaseOrderTotals(lines);

          const number = await this.sequences.next(manager, companyId, PURCHASE_ORDER_SERIES);
          const repo = manager.getRepository(PurchaseOrder);
          const purchaseOrder = await repo.save(
            repo.create({
              companyId,
              supplierId,
              orderNumber: formatPurchaseOrderNumber(number),
              destinationLocationId: input.destinationLocationId,
              subtotal,
              total,
              expectedAt: input.expectedAt ?? null,
              createdBy: userId,
            }),
          );

          const itemRepo = manager.getRepository(PurchaseOrderItem);
          await itemRepo.save(
            lines.map((line) =>
              itemRepo.create({
                purchaseOrderId: purchaseOrder.id,
                productVariantId: line.productVariantId,
                quantity: line.quantity,
                unitCost: line.unitCost,
              }),
            ),
          );

          await this.signal(manager, companyId, purchaseOrder, userId);
          return purchaseOrder;
        },
        (id) => manager.getRepository(PurchaseOrder).findOneByOrFail({ id }),
      ),
    );
  }

  // La pone en firme: de aquí en más la mueve el proveedor, que la cuenta y la despacha. La manda
  // el administrador, o el proveedor mismo cuando es él quien armó la orden de lo que va a entregar.
  async send(
    companyId: string,
    actorUserId: string,
    id: string,
    supplierScope?: string,
  ): Promise<PurchaseOrder> {
    await this.findOne(companyId, id, supplierScope);
    return this.dataSource.transaction(async (manager) => {
      const purchaseOrder = await this.lock(manager, companyId, id);
      if (purchaseOrder.status !== PurchaseOrderStatus.DRAFT) {
        throw new ConflictException('Solo se envía una orden en borrador');
      }
      purchaseOrder.status = PurchaseOrderStatus.SENT;
      const sent = await manager.getRepository(PurchaseOrder).save(purchaseOrder);
      await this.signal(manager, companyId, sent, actorUserId);
      return sent;
    });
  }

  // El PROVEEDOR despacha su propia orden (suppliers.register_delivery): la revisa, cuenta lo que
  // manda de cada referencia y la pone en camino. Solo él, nunca otro, y una sola vez: lo que no
  // alcance a mandar queda como novedad, no como una entrega pendiente (ver
  // purchase-order-shipping.ts). Puede mandar de más, pero entonces la orden no sigue hasta que el
  // administrador autorice el sobrante. Despachar no toca inventario.
  async ship(
    companyId: string,
    actorUserId: string,
    id: string,
    shipped: readonly PurchaseOrderItemCountInput[],
  ): Promise<PurchaseOrder> {
    await this.findOne(companyId, id);
    return this.dataSource.transaction(async (manager) => {
      const purchaseOrder = await this.lock(manager, companyId, id);
      this.assertSupplierActor(purchaseOrder, actorUserId);
      if (purchaseOrder.status !== PurchaseOrderStatus.SENT) {
        throw new ConflictException('Solo se despacha una orden ya enviada');
      }
      const { hasOverage, hasIncidents } = await registerShipment(manager, actorUserId, purchaseOrder, shipped);
      // De más no pasa derecho: lo autoriza el administrador antes de que bodega lo vea.
      purchaseOrder.status = hasOverage ? PurchaseOrderStatus.PENDING_APPROVAL : PurchaseOrderStatus.SHIPPED;
      purchaseOrder.shippedAt = new Date();
      purchaseOrder.hasIncidents = hasIncidents;
      const dispatched = await manager.getRepository(PurchaseOrder).save(purchaseOrder);
      await this.signal(manager, companyId, dispatched, actorUserId);
      return dispatched;
    });
  }

  // El ADMINISTRADOR zanja el sobrante de un despacho (suppliers.manage_purchase_orders), línea
  // por línea: lo que acepta entra cuando bodega lo reciba. Basta con que rechace UNA línea para
  // que el despacho entero se deshaga y la orden vuelva al proveedor (SENT) a contarla otra vez:
  // no se recibe media orden, y así el proveedor ve claro que tiene que volver a armar el envío.
  // El proveedor no se autoriza a sí mismo, tenga el permiso que tenga.
  async resolveOverage(
    companyId: string,
    actorUserId: string,
    id: string,
    decisions: readonly PurchaseOrderOverageDecisionInput[],
  ): Promise<PurchaseOrder> {
    await this.findOne(companyId, id);
    return this.dataSource.transaction(async (manager) => {
      const purchaseOrder = await this.lock(manager, companyId, id);
      if (purchaseOrder.supplierId === actorUserId) {
        throw new ForbiddenException('El proveedor de la orden no puede autorizar su propio sobrante');
      }
      if (purchaseOrder.status !== PurchaseOrderStatus.PENDING_APPROVAL) {
        throw new ConflictException('Esta orden no tiene un sobrante por autorizar');
      }

      const items = await overageItems(manager, purchaseOrder);
      const decided = new Map<string, boolean>();
      for (const decision of decisions) {
        if (!items.some((item) => item.id === decision.itemId)) {
          throw new NotFoundException(`La línea ${decision.itemId} no tiene sobrante en esta orden`);
        }
        if (decided.has(decision.itemId)) throw new BadRequestException('Una línea viene repetida');
        decided.set(decision.itemId, decision.accepted);
      }
      if (decided.size !== items.length) throw new BadRequestException('Falta decidir sobre una referencia');

      if ([...decided.values()].every(Boolean)) {
        const incidentIds = items.map((item) => item.shipmentIncidentId).filter((value): value is string => value !== null);
        await closeShipmentIncidents(manager, incidentIds, actorUserId, IncidentStatus.RESOLVED);
        purchaseOrder.status = PurchaseOrderStatus.SHIPPED;
      } else {
        await clearShipment(manager, purchaseOrder, actorUserId);
        purchaseOrder.status = PurchaseOrderStatus.SENT;
        purchaseOrder.shippedAt = null;
        purchaseOrder.hasIncidents = false;
      }

      const resolved = await manager.getRepository(PurchaseOrder).save(purchaseOrder);
      await this.signal(manager, companyId, resolved, actorUserId);
      return resolved;
    });
  }

  // El BODEGUERO acepta la orden después de contarla (warehouse.fulfill_orders): acá —y solo acá—
  // entra la existencia al inventario de la bodega destino, con lo que él contó (ver
  // PurchaseOrderReceivingService). El proveedor de la orden no la recibe aunque tenga el permiso:
  // quien despacha no se firma a sí mismo la llegada.
  async receive(
    companyId: string,
    actorUserId: string,
    id: string,
    counted: readonly PurchaseOrderItemCountInput[],
  ): Promise<PurchaseOrder> {
    await this.findOne(companyId, id);
    return this.dataSource.transaction(async (manager) => {
      const purchaseOrder = await this.lock(manager, companyId, id);
      if (purchaseOrder.supplierId === actorUserId) {
        throw new ForbiddenException('El proveedor de la orden no puede recibirla en bodega');
      }
      if (purchaseOrder.status === PurchaseOrderStatus.PENDING_APPROVAL) {
        throw new ConflictException('El administrador todavía no autoriza el sobrante de esta orden');
      }
      if (purchaseOrder.status !== PurchaseOrderStatus.SHIPPED) {
        throw new ConflictException('Solo se recibe una orden que el proveedor ya despachó');
      }
      const mismatched = await this.receiving.receive(manager, companyId, actorUserId, purchaseOrder, counted);
      purchaseOrder.status = PurchaseOrderStatus.RECEIVED;
      purchaseOrder.hasIncidents = purchaseOrder.hasIncidents || mismatched;
      purchaseOrder.receivedAt = new Date();
      purchaseOrder.receivedBy = actorUserId;
      const received = await manager.getRepository(PurchaseOrder).save(purchaseOrder);
      await this.signal(manager, companyId, received, actorUserId);
      return received;
    });
  }

  // Quien gestiona las compras de la empresa (`canManagePurchasing`, ver el resolver) o el proveedor
  // de la orden pueden cancelarla mientras no esté ya recibida.
  async cancel(
    companyId: string,
    actor: { userId: string; canManagePurchasing: boolean },
    id: string,
    reason?: string,
  ): Promise<PurchaseOrder> {
    await this.findOne(companyId, id);
    return this.dataSource.transaction(async (manager) => {
      const purchaseOrder = await this.lock(manager, companyId, id);
      if (
        purchaseOrder.status === PurchaseOrderStatus.RECEIVED ||
        purchaseOrder.status === PurchaseOrderStatus.CANCELLED
      ) {
        throw new ConflictException('Esta orden ya no se puede cancelar');
      }
      const isSupplier = purchaseOrder.supplierId === actor.userId;
      if (!actor.canManagePurchasing && !isSupplier) {
        throw new ForbiddenException('Solo quien gestiona compras, o el proveedor, puede cancelar esta orden');
      }
      purchaseOrder.status = PurchaseOrderStatus.CANCELLED;
      purchaseOrder.cancelledAt = new Date();
      purchaseOrder.cancelledBy = actor.userId;
      purchaseOrder.cancellationReason = reason?.trim() || null;
      const cancelled = await manager.getRepository(PurchaseOrder).save(purchaseOrder);
      await this.signal(manager, companyId, cancelled, actor.userId);
      return cancelled;
    });
  }

  // Avisa en vivo del cambio a quienes siguen la orden (ver purchase-order-watchers.ts). Va dentro de
  // la transacción: la señal sale sola cuando esta se confirme, y si se deshace no sale.
  private signal(
    manager: EntityManager,
    companyId: string,
    purchaseOrder: PurchaseOrder,
    actorId: string,
  ): Promise<void> {
    return signalPurchaseOrderChange(manager, this.notifications, companyId, purchaseOrder, actorId);
  }

  private assertSupplierActor(purchaseOrder: PurchaseOrder, actorUserId: string): void {
    if (purchaseOrder.supplierId !== actorUserId) {
      throw new ForbiddenException('Solo el proveedor de esta orden puede hacer esto');
    }
  }

  private async lock(manager: EntityManager, companyId: string, id: string): Promise<PurchaseOrder> {
    const purchaseOrder = await manager
      .getRepository(PurchaseOrder)
      .findOne({ where: { id, companyId }, lock: { mode: 'pessimistic_write' } });
    if (!purchaseOrder) throw new NotFoundException(`Orden de compra ${id} no encontrada`);
    return purchaseOrder;
  }

  // La mercancía comprada solo entra por bodega: las tiendas no reciben órdenes de compra.
  private async assertLocation(manager: EntityManager, companyId: string, locationId: string): Promise<void> {
    const location = await manager.getRepository(Location).findOneBy({ id: locationId, companyId });
    if (!location) throw new NotFoundException(`Sede ${locationId} no encontrada`);
    if (location.type !== LocationType.WAREHOUSE) {
      throw new BadRequestException('El destino de una orden de compra debe ser una bodega');
    }
  }

  // Valida las líneas pedidas (variantes de la empresa, sin repetir, cantidad > 0) y les pone costo:
  // el que se escribió o, si no, el costo vigente de la variante.
  private async priceLines(
    manager: EntityManager,
    companyId: string,
    items: readonly PurchaseOrderItemInput[],
  ): Promise<PricedItemLine[]> {
    const ids = items.map((item) => item.productVariantId);
    if (new Set(ids).size !== ids.length) throw new BadRequestException('Una variante viene repetida en la orden');

    const variants = await manager.getRepository(ProductVariant).find({ where: { id: In(ids), companyId } });
    const variantById = new Map(variants.map((variant) => [variant.id, variant]));

    return items.map((item) => {
      const variant = variantById.get(item.productVariantId);
      if (!variant) throw new NotFoundException(`Variante ${item.productVariantId} no encontrada`);
      const quantity = new Decimal(item.quantity);
      if (quantity.lessThanOrEqualTo(0)) throw new BadRequestException('La cantidad pedida debe ser mayor que cero');
      return {
        productVariantId: variant.id,
        quantity,
        unitCost: item.unitCost === undefined ? variant.cost : new Decimal(item.unitCost),
      };
    });
  }
}
