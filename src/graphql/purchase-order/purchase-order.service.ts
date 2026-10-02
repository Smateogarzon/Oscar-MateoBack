import { ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Decimal } from 'decimal.js';
import { DataSource, EntityManager, Repository } from 'typeorm';
import { RecordStatus } from '../../common/enums/record-status.enum.js';
import { runIdempotent } from '../idempotency/idempotency.js';
import { Location } from '../location/entities/location.entity.js';
import { DocumentSequenceService } from '../document-sequence/document-sequence.service.js';
import { User } from '../user/entities/user.entity.js';
import { UserCompanyRole } from '../user-company-role/entities/user-company-role.entity.js';
import { CreatePurchaseOrderInput } from './dto/create-purchase-order.input.js';
import { PurchaseOrderStatus } from './entities/purchase-order-status.enum.js';
import { PurchaseOrder } from './entities/purchase-order.entity.js';
import { formatPurchaseOrderNumber, PURCHASE_ORDER_SERIES } from './purchase-order-number.js';

// El rol que marca a un usuario como proveedor (ver V0.1_add_role / V0.2_seed_role, scope SUPPLIER).
const SUPPLIER_ROLE_CODE = 'SUPPLIER';

export interface PurchaseOrderFilter {
  status?: PurchaseOrderStatus;
  supplierId?: string;
}

// Una orden de compra (ver la entidad). Sin tabla de líneas todavía: recibirla cambia el estado,
// pero no crea movimientos de inventario (no hay de dónde saber qué variante ni cuánto llegó).
@Injectable()
export class PurchaseOrderService {
  constructor(
    @InjectRepository(PurchaseOrder)
    private readonly purchaseOrderRepository: Repository<PurchaseOrder>,
    private readonly dataSource: DataSource,
    private readonly sequences: DocumentSequenceService,
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

  async findOne(companyId: string, id: string): Promise<PurchaseOrder> {
    const purchaseOrder = await this.purchaseOrderRepository.findOneBy({ id, companyId });
    if (!purchaseOrder) throw new NotFoundException(`Orden de compra ${id} no encontrada`);
    return purchaseOrder;
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
          await this.assertSupplier(manager, companyId, input.supplierId);
          await this.assertLocation(manager, companyId, input.destinationLocationId);

          const number = await this.sequences.next(manager, companyId, PURCHASE_ORDER_SERIES);
          const repo = manager.getRepository(PurchaseOrder);
          return repo.save(
            repo.create({
              companyId,
              supplierId: input.supplierId,
              orderNumber: formatPurchaseOrderNumber(number),
              destinationLocationId: input.destinationLocationId,
              subtotal: new Decimal(input.subtotal ?? '0'),
              total: new Decimal(input.total ?? '0'),
              expectedAt: input.expectedAt ?? null,
              notes: input.notes?.trim() || null,
              createdBy: userId,
            }),
          );
        },
        (id) => manager.getRepository(PurchaseOrder).findOneByOrFail({ id }),
      ),
    );
  }

  // La manda al proveedor: de aquí en más, el proveedor es quien la mueve (confirm/receive).
  async send(companyId: string, id: string): Promise<PurchaseOrder> {
    await this.findOne(companyId, id);
    return this.dataSource.transaction(async (manager) => {
      const purchaseOrder = await this.lock(manager, companyId, id);
      if (purchaseOrder.status !== PurchaseOrderStatus.DRAFT) {
        throw new ConflictException('Solo se envía una orden en borrador');
      }
      purchaseOrder.status = PurchaseOrderStatus.SENT;
      return manager.getRepository(PurchaseOrder).save(purchaseOrder);
    });
  }

  // El PROVEEDOR confirma su propia orden (suppliers.confirm_purchase_order): solo él, nunca otro.
  async confirm(companyId: string, actorUserId: string, id: string): Promise<PurchaseOrder> {
    await this.findOne(companyId, id);
    return this.dataSource.transaction(async (manager) => {
      const purchaseOrder = await this.lock(manager, companyId, id);
      this.assertSupplierActor(purchaseOrder, actorUserId);
      if (purchaseOrder.status !== PurchaseOrderStatus.SENT) {
        throw new ConflictException('Solo se confirma una orden ya enviada');
      }
      purchaseOrder.status = PurchaseOrderStatus.CONFIRMED;
      purchaseOrder.confirmedAt = new Date();
      return manager.getRepository(PurchaseOrder).save(purchaseOrder);
    });
  }

  // El PROVEEDOR registra su propia entrega (suppliers.register_delivery). `partial` deja la orden
  // en PARTIALLY_RECEIVED (sigue pendiente el resto); sin él, en RECEIVED (ya no se espera más).
  async registerDelivery(
    companyId: string,
    actorUserId: string,
    id: string,
    partial: boolean,
  ): Promise<PurchaseOrder> {
    await this.findOne(companyId, id);
    return this.dataSource.transaction(async (manager) => {
      const purchaseOrder = await this.lock(manager, companyId, id);
      this.assertSupplierActor(purchaseOrder, actorUserId);
      if (
        purchaseOrder.status !== PurchaseOrderStatus.CONFIRMED &&
        purchaseOrder.status !== PurchaseOrderStatus.PARTIALLY_RECEIVED
      ) {
        throw new ConflictException('Solo se registra entrega de una orden confirmada');
      }
      purchaseOrder.status = partial ? PurchaseOrderStatus.PARTIALLY_RECEIVED : PurchaseOrderStatus.RECEIVED;
      purchaseOrder.receivedAt = new Date();
      return manager.getRepository(PurchaseOrder).save(purchaseOrder);
    });
  }

  // Quien la creó, o el proveedor de la orden, pueden cancelarla mientras no esté ya recibida.
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
      return manager.getRepository(PurchaseOrder).save(purchaseOrder);
    });
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

  private async assertLocation(manager: EntityManager, companyId: string, locationId: string): Promise<void> {
    const exists = await manager.getRepository(Location).existsBy({ id: locationId, companyId });
    if (!exists) throw new NotFoundException(`Sede ${locationId} no encontrada`);
  }

  // El proveedor es un usuario con el rol Proveedor en esta empresa (no cualquier usuario).
  private async assertSupplier(manager: EntityManager, companyId: string, supplierId: string): Promise<void> {
    const isSupplier = await manager.getRepository(UserCompanyRole).existsBy({
      userId: supplierId,
      companyId,
      status: RecordStatus.ACTIVE,
      role: { code: SUPPLIER_ROLE_CODE, status: RecordStatus.ACTIVE },
    });
    const accountActive =
      isSupplier && (await manager.getRepository(User).existsBy({ id: supplierId, status: RecordStatus.ACTIVE }));
    if (!accountActive) throw new NotFoundException(`Proveedor ${supplierId} no encontrado`);
  }
}
