import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Decimal } from 'decimal.js';
import { Brackets, DataSource, EntityManager, In, Repository } from 'typeorm';
import { assertStoreAccess } from '../../common/access/store-access.js';
import { PermissionCode } from '../../common/enums/permission-code.enum.js';
import { RecordStatus } from '../../common/enums/record-status.enum.js';
import { DocumentSequenceService } from '../document-sequence/document-sequence.service.js';
import { runIdempotent } from '../idempotency/idempotency.js';
import { IncidentStatus } from '../incident/entities/incident-status.enum.js';
import { IncidentType } from '../incident/entities/incident-type.enum.js';
import { Incident } from '../incident/entities/incident.entity.js';
import { InventoryLocationType } from '../inventory-location/entities/inventory-location-type.enum.js';
import { LocationType } from '../location/entities/location-type.enum.js';
import { Location } from '../location/entities/location.entity.js';
import { NotificationType } from '../notification/entities/notification-type.enum.js';
import { NotificationService } from '../notification/notification.service.js';
import { ReturnsBinService } from '../returns-bin/returns-bin.service.js';
import { ProductVariant } from '../product-variant/entities/product-variant.entity.js';
import { SaleStatus } from '../sale/entities/sale-status.enum.js';
import { Sale } from '../sale/entities/sale.entity.js';
import { UserLocationAccess } from '../user-location-access/entities/user-location-access.entity.js';
import { User } from '../user/entities/user.entity.js';
import type { InternalOrderChangeInput } from './dto/internal-order-change.input.js';
import type { InternalOrderLineCountInput } from './dto/internal-order-line-count.input.js';
import type { InternalOrdersFilterInput } from './dto/internal-orders-filter.input.js';
import type { RequestInternalOrderInput } from './dto/request-internal-order.input.js';
import type { TransitionInternalOrderInput } from './dto/transition-internal-order.input.js';
import { InternalOrderCorrectionItem } from './entities/internal-order-correction-item.entity.js';
import { InternalOrderCorrection } from './entities/internal-order-correction.entity.js';
import { InternalOrderEventKind } from './entities/internal-order-event-kind.enum.js';
import { InternalOrderEvent } from './entities/internal-order-event.entity.js';
import { InternalOrderItem } from './entities/internal-order-item.entity.js';
import { InternalOrderNudge } from './entities/internal-order-nudge.enum.js';
import { InternalOrderOrigin } from './entities/internal-order-origin.enum.js';
import { InternalOrderPriority } from './entities/internal-order-priority.enum.js';
import { InternalOrderStatus as S } from './entities/internal-order-status.enum.js';
import { InternalOrderType } from './entities/internal-order-type.enum.js';
import { InternalOrderVersion } from './entities/internal-order-version.entity.js';
import { InternalOrder } from './entities/internal-order.entity.js';
import {
  FINAL_STATUSES,
  INITIAL_STATUS,
  isFinalStatus,
  PICKED_UP_STATUSES,
  RUNNER_ENGAGED_STATUSES,
  stepFor,
  WAITING_RUNNER_STATUSES,
  type FlowStep,
} from './internal-order-flow.js';
import { formatInternalOrderNumber, INTERNAL_ORDER_SERIES } from './internal-order-number.js';
import { InternalOrderStock, quantitiesOf, type VariantQuantities } from './internal-order-stock.js';
import { applyVisibility, canSeeOrder, visibilityOf, type OrderVisibility } from './internal-order-visibility.js';
import { notifyInternalOrder, signalInternalOrderChange } from './internal-order-watchers.js';

// Quién hace la operación: sus permisos en la empresa activa (los del token ya resueltos), si es
// super admin (lo puede todo, también hacer un paso por el corredor asignado) y si administra la
// empresa (Administrador o super admin: para los pasos que son solo del administrador).
export interface OrderActor {
  userId: string;
  permissionCodes: readonly string[];
  isSuperAdmin: boolean;
  isAdmin: boolean;
}

// Un retorno por error con las líneas que llegaron equivocadas ya resueltas (`internal_order_
// correction_items` solo guarda sus ids, y pueden ser de una versión anterior de la orden).
export type InternalOrderCorrectionView = InternalOrderCorrection & { items: InternalOrderItem[] };

// Una orden lista para mostrarse: con sus líneas vigentes, su bitácora y sus correcciones, y el
// número de la venta que la cobró (si la hay). Lo arma `hydrate` en pocas consultas, no una por orden.
export type InternalOrderView = InternalOrder & {
  items: InternalOrderItem[];
  events: InternalOrderEvent[];
  corrections: InternalOrderCorrectionView[];
  incidents: Incident[];
  saleNumber: string | null;
};

// Las novedades que se pueden reportar sobre una orden en curso (las de bodega al alistar y al
// verificar una devolución las abre el propio flujo).
export const ORDER_INCIDENT_TYPES: readonly IncidentType[] = [
  IncidentType.NOT_FOUND,
  IncidentType.DAMAGE,
  IncidentType.ORDER_ISSUE,
  IncidentType.DELIVERY_ISSUE,
];

export interface OrderIncidentReport {
  orderId: string;
  itemId?: string;
  type: IncidentType;
  description: string;
}

// Con qué valores de entityType una novedad queda ligada a una orden o a una de sus líneas.
export const ORDER_INCIDENT_ENTITY = 'INTERNAL_ORDER';
export const ORDER_ITEM_INCIDENT_ENTITY = 'INTERNAL_ORDER_ITEM';

const INCIDENT_TITLES: Partial<Record<IncidentType, string>> = {
  [IncidentType.NOT_FOUND]: 'Producto faltante',
  [IncidentType.DAMAGE]: 'Producto dañado',
  [IncidentType.ORDER_ISSUE]: 'Problema con la orden',
  [IncidentType.DELIVERY_ISSUE]: 'Problema en la entrega',
};

export type InternalOrderVersionView = InternalOrderVersion & { items: InternalOrderItem[] };

export interface OrderStockOption {
  productVariantId: string;
  locationId: string;
  locationName: string;
  locationType: LocationType;
  available: Decimal;
}

const ORDER_RELATIONS = {
  sourceLocation: true,
  destinationLocation: true,
  requestedByUser: true,
  warehouseOperator: true,
  runner: true,
  receivedByUser: true,
  cancelledByUser: true,
  parentOrder: true,
  relatedOrder: true,
} as const;
const ITEM_RELATIONS = { productVariant: { product: true, color: true, size: true } } as const;

// "Air Jordan 1 · Rojo / 39 y Air Max 90 · Negro / 38": cómo se nombran en la bitácora, en las
// novedades y en los avisos las líneas que llegaron equivocadas. Pide las líneas con ITEM_RELATIONS;
// sin ellas no hay con qué nombrarlas.
const linesLabel = (items: InternalOrderItem[]): string =>
  items
    .map((item) =>
      item.productVariant?.product
        ? `${item.productVariant.product.name} · ${item.productVariant.color.name} / ${item.productVariant.size.name}`
        : 'una referencia',
    )
    .join(' y ');

// Quién puede reportar una novedad sobre una orden.
const INCIDENT_REPORTERS: readonly PermissionCode[] = [
  PermissionCode.RUNNER_REPORT_INCIDENT,
  PermissionCode.ORDERS_CONFIRM_RECEIPT,
  PermissionCode.WAREHOUSE_FULFILL_ORDERS,
];

// Pedir una SO es del vendedor; un traslado o un surtido, de quien maneja transferencias o bodega.
const REQUEST_PERMISSIONS: Record<Exclude<InternalOrderType, InternalOrderType.RE>, readonly PermissionCode[]> = {
  [InternalOrderType.SO]: [PermissionCode.ORDERS_REQUEST_FROM_WAREHOUSE],
  [InternalOrderType.TR]: [PermissionCode.INVENTORY_TRANSFER, PermissionCode.WAREHOUSE_FULFILL_ORDERS],
  [InternalOrderType.RS]: [PermissionCode.INVENTORY_TRANSFER, PermissionCode.WAREHOUSE_FULFILL_ORDERS],
};

// Las órdenes internas de los cuatro tipos (SO, RE, TR, RS): crearlas, moverlas por su flujo (ver
// internal-order-flow.ts), versionarlas, ligarlas entre sí y con la venta que cobra una SO. Toda
// operación es una transacción con la orden bloqueada, deja su evento en la bitácora, aparta o mueve
// inventario según el paso (internal-order-stock.ts) y avisa a quien hace el paso siguiente.
@Injectable()
export class InternalOrderService {
  constructor(
    @InjectRepository(InternalOrder)
    private readonly internalOrderRepository: Repository<InternalOrder>,
    private readonly dataSource: DataSource,
    private readonly sequences: DocumentSequenceService,
    private readonly stock: InternalOrderStock,
    private readonly notifications: NotificationService,
    private readonly returnsBin: ReturnsBinService,
  ) {}

  // ─── Consultas ─────────────────────────────────────────────────────────────────────────────

  // `activeSince`: el tablero del día (lo que sigue abierto, más lo que se cerró desde esa fecha).
  // `open: false` con `closedFrom`/`closedTo`: el histórico (por la fecha en que se cerró).
  async findAll(companyId: string, actor: OrderActor, filter: InternalOrdersFilterInput = {}): Promise<InternalOrderView[]> {
    const query = this.internalOrderRepository
      .createQueryBuilder('o')
      .leftJoinAndSelect('o.sourceLocation', 'sourceLocation')
      .leftJoinAndSelect('o.destinationLocation', 'destinationLocation')
      .leftJoinAndSelect('o.requestedByUser', 'requestedByUser')
      .leftJoinAndSelect('o.warehouseOperator', 'warehouseOperator')
      .leftJoinAndSelect('o.runner', 'runner')
      .leftJoinAndSelect('o.receivedByUser', 'receivedByUser')
      .leftJoinAndSelect('o.cancelledByUser', 'cancelledByUser')
      .leftJoinAndSelect('o.parentOrder', 'parentOrder')
      .leftJoinAndSelect('o.relatedOrder', 'relatedOrder')
      .where('o.companyId = :companyId', { companyId });

    // Lo que cada quien ve lo decide internal-order-visibility.ts; `mine` acota además a lo que pidió.
    applyVisibility(query, 'o', await this.visibilityOf(this.dataSource.manager, companyId, actor));
    if (filter.mine) query.andWhere('o.requestedBy = :me', { me: actor.userId });
    if (filter.type) query.andWhere('o.type = :type', { type: filter.type });
    if (filter.status) query.andWhere('o.status = :status', { status: filter.status });
    if (filter.destinationLocationId) {
      query.andWhere('o.destinationLocationId = :destinationLocationId', { destinationLocationId: filter.destinationLocationId });
    }
    if (filter.open === true) query.andWhere('o.status NOT IN (:...finals)', { finals: FINAL_STATUSES });
    if (filter.open === false) query.andWhere('o.status IN (:...finals)', { finals: FINAL_STATUSES });
    if (filter.closedFrom) query.andWhere('o.statusChangedAt >= :closedFrom', { closedFrom: filter.closedFrom });
    if (filter.closedTo) query.andWhere('o.statusChangedAt <= :closedTo', { closedTo: filter.closedTo });
    if (filter.activeSince) {
      query.andWhere('(o.status NOT IN (:...finals) OR o.statusChangedAt >= :activeSince)', {
        finals: FINAL_STATUSES,
        activeSince: filter.activeSince,
      });
    }

    const orders = await query.orderBy('o.createdAt', 'DESC').getMany();
    return this.hydrate(this.dataSource.manager, orders);
  }

  async findDetailed(companyId: string, actor: OrderActor, id: string): Promise<InternalOrderView> {
    const view = await this.findView(companyId, id);
    if (!(await this.canSee(companyId, actor, view))) throw new NotFoundException(`Orden ${id} no encontrada`);
    return view;
  }

  // La orden lista para mostrarse, sin revisar quién la pide: lo que devuelve una operación que ya
  // validó su permiso (quien acaba de moverla puede verla).
  async findView(companyId: string, id: string): Promise<InternalOrderView> {
    const order = await this.internalOrderRepository.findOne({ where: { id, companyId }, relations: ORDER_RELATIONS });
    if (!order) throw new NotFoundException(`Orden ${id} no encontrada`);
    const [view] = await this.hydrate(this.dataSource.manager, [order]);
    return view;
  }

  // La variante con su producto, color y talla, para una línea que no la trajo cargada.
  findVariant(id: string): Promise<ProductVariant | null> {
    return this.dataSource.manager.findOne(ProductVariant, { where: { id }, relations: { product: true, color: true, size: true } });
  }

  // Todas las versiones de la orden, de la primera a la vigente, cada una con sus líneas.
  async findVersions(companyId: string, actor: OrderActor, id: string): Promise<InternalOrderVersionView[]> {
    await this.findDetailed(companyId, actor, id);
    const versions = await this.dataSource.manager.find(InternalOrderVersion, {
      where: { internalOrderId: id },
      relations: { createdByUser: true, sourceLocation: true },
      order: { versionNumber: 'ASC' },
    });
    const items = await this.dataSource.manager.find(InternalOrderItem, {
      where: { internalOrderId: id },
      relations: ITEM_RELATIONS,
      order: { createdAt: 'ASC' },
    });
    return versions.map((version) =>
      Object.assign(version, { items: items.filter((item) => item.versionNumber === version.versionNumber) }),
    );
  }

  // Las sub-órdenes de una SO (cambios de pedido que despachó otra bodega).
  async findSubOrders(companyId: string, id: string): Promise<InternalOrderView[]> {
    const orders = await this.internalOrderRepository.find({
      where: { companyId, parentOrderId: id },
      relations: ORDER_RELATIONS,
      order: { createdAt: 'ASC' },
    });
    return this.hydrate(this.dataSource.manager, orders);
  }

  // Las sedes en que trabaja quien consulta (Configuración → Personal por ubicación); el super admin,
  // todas las activas de la empresa. Es de donde el vendedor pide y a donde le llega.
  async myLocations(companyId: string, actor: OrderActor): Promise<Location[]> {
    if (actor.isSuperAdmin) {
      return this.dataSource.manager.find(Location, { where: { companyId, status: RecordStatus.ACTIVE }, order: { name: 'ASC' } });
    }
    const ids = await this.accessibleLocationIds(this.dataSource.manager, companyId, actor);
    if (ids.length === 0) return [];
    return this.dataSource.manager.find(Location, {
      where: { id: In(ids), companyId, status: RecordStatus.ACTIVE },
      order: { name: 'ASC' },
    });
  }

  // Cuánto hay disponible (lo que hay menos lo apartado) de cada variante en cada sede con STOCK
  // activo —de un producto, o de todos—: con esto el vendedor elige talla, color y bodega al pedir o
  // al cambiar, y el catálogo muestra lo que hay en la bodega elegida.
  async stockOptions(companyId: string, productId?: string): Promise<OrderStockOption[]> {
    const rows: { productVariantId: string; locationId: string; locationName: string; locationType: LocationType; available: string }[] =
      await this.dataSource.manager.query(
        `SELECT b."productVariantId" AS "productVariantId", loc.id AS "locationId", loc.name AS "locationName",
                loc.type AS "locationType", (b.quantity - COALESCE(r.reserved, 0))::text AS "available"
           FROM inventory_balances b
           JOIN inventory_locations il ON il.id = b."inventoryLocationId"
           JOIN locations loc ON loc.id = il."locationId"
           JOIN product_variants pv ON pv.id = b."productVariantId"
           LEFT JOIN (SELECT res."productVariantId", res."inventoryLocationId", SUM(res.quantity) AS reserved
                        FROM inventory_reservations res
                       GROUP BY res."productVariantId", res."inventoryLocationId") r
             ON r."productVariantId" = b."productVariantId" AND r."inventoryLocationId" = b."inventoryLocationId"
          WHERE il."companyId" = $1::uuid
            AND il.type = $2::inventory_location_type
            AND il.status = $3::record_status
            AND loc.status = $3::record_status
            ${productId ? 'AND pv."productId" = $4::uuid' : ''}
            AND pv.status = $3::record_status
            AND b.quantity - COALESCE(r.reserved, 0) > 0
          ORDER BY loc.name ASC`,
        [companyId, InventoryLocationType.STOCK, RecordStatus.ACTIVE, ...(productId ? [productId] : [])],
      );
    return rows.map((row) => ({ ...row, available: new Decimal(row.available) }));
  }

  // El número de una orden, para la venta que la cobró.
  async numberOf(id: string): Promise<string | null> {
    const order = await this.internalOrderRepository.findOne({ select: { orderNumber: true }, where: { id } });
    return order?.orderNumber ?? null;
  }

  // ─── Crear ─────────────────────────────────────────────────────────────────────────────────

  // Pide una orden: una SO (el vendedor pide a bodega lo que el cliente quiere), un TR o un RS (desde
  // Inventario → Transferencia). Aparta lo pedido en el STOCK del origen desde ya: si no hay, no nace.
  async request(
    companyId: string,
    actor: OrderActor,
    input: RequestInternalOrderInput,
    idempotencyKey?: string,
  ): Promise<InternalOrder> {
    if (!this.has(actor, REQUEST_PERMISSIONS[input.type])) {
      throw new ForbiddenException('No tienes permiso para pedir este tipo de orden');
    }
    if (input.sourceLocationId === input.destinationLocationId) {
      throw new BadRequestException('El origen y el destino no pueden ser la misma sede');
    }

    return this.dataSource.transaction((manager) =>
      runIdempotent(
        manager,
        { companyId, userId: actor.userId, operation: 'requestInternalOrder', key: idempotencyKey, input, resourceType: 'internalOrder' },
        async () => {
          const source = await this.activeLocation(manager, companyId, input.sourceLocationId);
          const destination = await this.activeLocation(manager, companyId, input.destinationLocationId);
          if (input.type === InternalOrderType.SO || input.type === InternalOrderType.RS) {
            if (source.type !== LocationType.WAREHOUSE) throw new BadRequestException(`${source.name} no es una bodega`);
            if (destination.type !== LocationType.STORE) throw new BadRequestException(`${destination.name} no es una tienda`);
          }
          // El vendedor pide para la tienda en que trabaja.
          if (input.type === InternalOrderType.SO) await assertStoreAccess(manager, actor.userId, destination.id);

          const lines = await this.pricedLines(manager, companyId, input.type, mergeLines(input.items));
          const order = await this.createOrder(manager, companyId, actor.userId, {
            type: input.type,
            origin: input.origin,
            priority: InternalOrderPriority.NORMAL,
            sourceLocationId: source.id,
            destinationLocationId: destination.id,
            deliveryPoint: input.deliveryPoint?.trim() || null,
            requestedBy: actor.userId,
            parentOrderId: null,
            relatedOrderId: null,
            notes: input.notes?.trim() || null,
            reason: 'Creación de la orden',
            createdDetail: `Orden creada · ${lines.length} ${lines.length === 1 ? 'referencia' : 'referencias'} de ${source.name} para ${destination.name}`,
            createdAt: destination.id,
            lines,
          });
          await this.stock.reserveAt(manager, companyId, order, source.id, quantitiesOf(lines), actor.userId);
          await notifyInternalOrder(manager, this.notifications, companyId, order, NotificationType.ORDER_REQUESTED, ['WAREHOUSE'], actor.userId);
          await signalInternalOrderChange(manager, this.notifications, companyId, order, actor.userId);
          return order;
        },
        (id) => manager.getRepository(InternalOrder).findOneByOrFail({ id }),
      ),
    );
  }

  // ─── Transiciones ──────────────────────────────────────────────────────────────────────────

  // Mueve la orden al estado `to`, si el flujo de su tipo lo permite desde donde está y quien lo pide
  // puede (ver internal-order-flow.ts). `lines` lleva lo encontrado al alistar (READY) o lo contado al
  // recibir una devolución (VERIFY_RETURN); `reason`, el motivo de una anulación.
  async transition(companyId: string, actor: OrderActor, input: TransitionInternalOrderInput): Promise<InternalOrder> {
    return this.dataSource.transaction(async (manager) => {
      const order = await this.lock(manager, companyId, input.id);
      await this.assertCanSee(manager, companyId, actor, order);
      const step = stepFor(order.type, order.status, input.to);
      if (!step) throw new ConflictException(`La orden #${order.orderNumber} no puede pasar de ${order.status} a ${input.to}`);
      this.assertStepAllowed(order, step, actor);

      await this.applyEffect(manager, companyId, order, step, actor, input);
      await signalInternalOrderChange(manager, this.notifications, companyId, order, actor.userId);
      return order;
    });
  }

  private assertStepAllowed(order: InternalOrder, step: FlowStep, actor: OrderActor): void {
    if (step.actor === 'ADMIN') {
      if (!actor.isAdmin) throw new ForbiddenException('Solo el administrador puede hacer esto');
      return;
    }
    const permitted = this.has(actor, step.permissions);
    if (step.actor === 'REQUESTER') {
      if (!permitted && order.requestedBy !== actor.userId) throw new ForbiddenException('Solo quien la pidió, o quien tiene el permiso, puede hacer esto');
      return;
    }
    if (!permitted) throw new ForbiddenException('No tienes permiso para hacer este paso');
    if (step.actor === 'RUNNER' && order.runnerId !== actor.userId && !actor.isSuperAdmin) {
      throw new ForbiddenException('Solo el corredor que la lleva puede hacer esto');
    }
    // Para recoger hay que haber tomado la orden antes (claim), y solo la recoge quien la tomó (o el
    // super admin, por él).
    if (step.effect === 'PICK_UP' && !actor.isSuperAdmin) {
      if (!order.runnerId) throw new ForbiddenException('Toma la orden antes de recogerla');
      if (order.runnerId !== actor.userId) throw new ForbiddenException('Otro corredor ya tomó esta orden');
    }
  }

  private async applyEffect(
    manager: EntityManager,
    companyId: string,
    order: InternalOrder,
    step: FlowStep,
    actor: OrderActor,
    input: TransitionInternalOrderInput,
  ): Promise<void> {
    const me = actor.userId;
    switch (step.effect) {
      case 'PACK':
        order.warehouseOperatorId ??= me;
        await this.setStatus(manager, order, step.to, me, step.detail, order.sourceLocationId);
        return;

      case 'READY': {
        order.warehouseOperatorId ??= me;
        const items = await this.currentItems(manager, order);
        const shortages = await this.recordCounts(manager, companyId, order, items, input.lines, me, 'READY');
        const quantities = quantitiesOf(items);
        if (quantities.size === 0) throw new ConflictException('No se encontró nada de esta orden: anúlala en vez de dejarla lista');
        await this.stock.reserveAt(manager, companyId, order, order.sourceLocationId, quantities, me);
        const detail = shortages > 0 ? `${step.detail} · ${shortages} ${shortages === 1 ? 'línea incompleta' : 'líneas incompletas'}` : step.detail;
        await this.setStatus(manager, order, step.to, me, detail, order.sourceLocationId);
        await notifyInternalOrder(manager, this.notifications, companyId, order, NotificationType.ORDER_READY_FOR_RUNNER, ['RUNNERS'], me, {
          locationId: order.sourceLocationId,
        });
        return;
      }

      case 'PICK_UP': {
        // Si un corredor la tomó, la lleva él aunque el super admin haga el paso por él.
        const runnerId = order.runnerId ?? me;
        const items = await this.currentItems(manager, order);
        order.runnerId = runnerId;
        await this.stock.release(manager, order.id);
        await this.stock.toRunner(manager, companyId, order, runnerId, quantitiesOf(items), me);
        await this.setStatus(manager, order, step.to, me, `${step.detail} · ${await this.nameOf(manager, runnerId)}`, order.sourceLocationId);
        return;
      }

      // El corredor marca la entrega física: la mercancía sigue en su bolsa (bajo su custodia) hasta
      // que el destino confirme el recibo.
      case 'DELIVER':
        if (!order.runnerId) throw new ConflictException('Esta orden no tiene corredor');
        await this.setStatus(
          manager,
          order,
          step.to,
          me,
          `${step.detail} · ${await this.locationName(manager, order.destinationLocationId)} · esperando confirmación`,
          order.destinationLocationId,
        );
        await notifyInternalOrder(manager, this.notifications, companyId, order, NotificationType.ORDER_DELIVERED, ['REQUESTER'], me);
        return;

      case 'RECEIVE':
        if (order.type === InternalOrderType.SO) await assertStoreAccess(manager, me, order.destinationLocationId);
        await this.handOver(manager, companyId, order, quantitiesOf(await this.currentItems(manager, order)), me);
        order.receivedBy = me;
        await this.setStatus(manager, order, step.to, me, `${step.detail} · termina la custodia del corredor`, order.destinationLocationId);
        if (order.type === InternalOrderType.SO && order.parentOrderId) await this.absorbParent(manager, companyId, order, me);
        return;

      case 'TO_PAYMENT':
        // Una sub-orden nunca se cobra dejando a su original esperando el cambio: si por lo que sea
        // no absorbió al recibirse (p. ej. se recibió con la regla anterior), lo hace ahora.
        if (order.type === InternalOrderType.SO && order.parentOrderId) await this.absorbParent(manager, companyId, order, me);
        await this.setStatus(manager, order, step.to, me, step.detail, order.destinationLocationId);
        await notifyInternalOrder(manager, this.notifications, companyId, order, NotificationType.ORDER_PENDING_PAYMENT, ['STORE_CASHIERS'], me);
        return;

      case 'BACK_TO_SELLER':
        await this.assertNoOpenSale(manager, order);
        await this.setStatus(manager, order, step.to, me, step.detail, order.destinationLocationId);
        return;

      // El cliente no compra: lo que tenía apartado pasa al cajón de devoluciones de la tienda (sigue
      // ahí, apartado para nadie) y la orden se cierra como devuelta.
      case 'RETURN_REQUEST': {
        await this.assertNoOpenSale(manager, order);
        const items = await this.currentItems(manager, order);
        await this.stock.release(manager, order.id);
        await this.returnsBin.hold(manager, companyId, {
          storeId: order.destinationLocationId,
          origin: { id: order.id, number: order.orderNumber },
          quantities: quantitiesOf(items),
          actorId: me,
          notify: true,
        });
        await this.setStatus(manager, order, step.to, me, `${step.detail} de ${await this.locationName(manager, order.destinationLocationId)}`, order.destinationLocationId);
        return;
      }

      case 'VERIFY_RETURN': {
        const items = await this.currentItems(manager, order);
        // Lo que el corredor trajo entra completo al cajón de devoluciones (termina su custodia); lo
        // que no cuadre se queda allí con su novedad y no pasa al STOCK.
        await this.handOver(manager, companyId, order, quantitiesOf(items), me);
        order.receivedBy = me;
        const mismatches = await this.recordCounts(manager, companyId, order, items, input.lines, me, 'VERIFY');
        // Recibir cierra el ticket: lo contado pasa del cajón de devoluciones a la existencia de la
        // bodega en el mismo paso, sin un segundo "cerrar" que no decide nada.
        await this.stock.returnsToStock(manager, companyId, order, quantitiesOf(items), me);
        const detail = mismatches > 0 ? `${step.detail} · ${mismatches} ${mismatches === 1 ? 'línea no cuadra' : 'líneas no cuadran'}` : step.detail;
        await this.setStatus(manager, order, step.to, me, detail, order.destinationLocationId);
        await this.closeReturnedSale(manager, companyId, order, me);
        return;
      }

      case 'CLOSE_RETURN': {
        const items = await this.currentItems(manager, order);
        await this.stock.returnsToStock(manager, companyId, order, quantitiesOf(items), me);
        await this.setStatus(manager, order, step.to, me, step.detail, order.destinationLocationId);
        await this.closeReturnedSale(manager, companyId, order, me);
        return;
      }

      case 'CLOSE':
        await this.setStatus(manager, order, step.to, me, step.detail, order.destinationLocationId);
        return;

      case 'CANCEL':
        await this.cancel(manager, companyId, order, step, me, input.reason);
        return;
    }
  }

  // El destino confirma el recibo y termina la custodia del corredor: de su bolsa al destino. Una SO
  // queda además apartada en la tienda para su cliente (nadie más la vende mientras se decide); una
  // RE entra al cajón de devoluciones.
  private async handOver(manager: EntityManager, companyId: string, order: InternalOrder, quantities: VariantQuantities, actorId: string): Promise<void> {
    if (!order.runnerId) throw new ConflictException('Esta orden no tiene corredor');
    const into = order.type === InternalOrderType.RE ? 'RETURNS' : 'STOCK';
    if (!(await this.stock.leftRunner(manager, order.id))) {
      await this.stock.fromRunner(manager, companyId, order, order.runnerId, quantities, into, actorId);
    }
    if (order.type === InternalOrderType.SO) {
      await this.stock.reserveAt(manager, companyId, order, order.destinationLocationId, quantities, actorId);
    }
  }

  // Anula antes de que el corredor recoja: suelta lo apartado. Una sub-orden anulada devuelve su
  // orden original a "recibida por el vendedor" (con lo que se quedó); una RE anulada (el cliente
  // cambió de opinión) devuelve su SO al vendedor con todo lo que tenía.
  private async cancel(
    manager: EntityManager,
    companyId: string,
    order: InternalOrder,
    step: FlowStep,
    actorId: string,
    reason?: string,
  ): Promise<void> {
    if (order.type === InternalOrderType.RE && !order.relatedOrderId) {
      // Una RE armada desde el cajón: lo que llevaba vuelve al cajón de la tienda.
      const items = await this.currentItems(manager, order);
      await this.stock.release(manager, order.id);
      await this.returnsBin.hold(manager, companyId, {
        storeId: order.sourceLocationId,
        origin: { id: order.id, number: order.orderNumber },
        quantities: quantitiesOf(items),
        actorId,
        notify: false,
      });
    } else if (order.type === InternalOrderType.RE) {
      const sale = order.relatedOrderId ? await this.lock(manager, companyId, order.relatedOrderId) : null;
      if (!sale || sale.status !== S.RETURN_REQUESTED) {
        throw new ConflictException('Esta devolución es parte de un cambio de pedido: no se cancela por separado');
      }
      const items = await this.currentItems(manager, sale);
      await this.stock.reserveAt(manager, companyId, sale, sale.destinationLocationId, quantitiesOf(items), actorId);
      await this.newVersion(manager, sale, `Devolución #${order.orderNumber} cancelada`, items, actorId);
      await this.setStatus(manager, sale, S.RECEIVED_BY_SELLER, actorId, `El cliente cambió de opinión · #${order.orderNumber} cancelada`, sale.destinationLocationId);
      await signalInternalOrderChange(manager, this.notifications, companyId, sale, actorId);
    } else {
      await this.stock.release(manager, order.id);
    }

    order.cancelledAt = new Date();
    order.cancelledBy = actorId;
    order.cancellationReason = reason?.trim() || null;
    await this.setStatus(manager, order, step.to, actorId, order.cancellationReason ? `${step.detail} · ${order.cancellationReason}` : step.detail, null);

    if (order.parentOrderId) await this.releaseParentAfterSubCancelled(manager, companyId, order, actorId);
  }

  private async releaseParentAfterSubCancelled(manager: EntityManager, companyId: string, sub: InternalOrder, actorId: string): Promise<void> {
    const parent = await this.lock(manager, companyId, sub.parentOrderId!);
    if (parent.status !== S.ITEM_CHANGE_REQUESTED) return;
    const kept = await this.currentItems(manager, parent);
    // Si no se quedó con nada, lo que queda es esperar la devolución del cambio: la SO se cierra
    // como devuelta cuando esa RE llegue a bodega.
    const to = kept.length > 0 ? S.RECEIVED_BY_SELLER : S.RETURN_REQUESTED;
    await this.setStatus(manager, parent, to, actorId, `La sub-orden #${sub.orderNumber} se anuló · sigue con lo que se quedó`, parent.destinationLocationId);
    await signalInternalOrderChange(manager, this.notifications, companyId, parent, actorId);
  }

  // La sub-orden de un cambio acaba de llegar a la tienda: se le suma lo que el cliente se quedó de
  // la orden original, de modo que quede con TODO lo que se lleva, y es ella la que sigue hasta el
  // pago. La original ya no tiene nada que entregar ni que cobrar: termina en CLOSED_BY_CHANGE
  // (terminada, sin cobro), con lo suyo devuelto en la RE o pasado a esta sub-orden.
  //
  // Lo apartado se mueve en el mismo orden: primero suelta lo de la original (si no, sus unidades
  // seguirían tomadas y la sub-orden no podría apartarlas), y después la sub-orden aparta todo en la
  // tienda, para el cliente, hasta que pague o devuelva.
  private async absorbParent(manager: EntityManager, companyId: string, sub: InternalOrder, actorId: string): Promise<void> {
    const parent = await this.lock(manager, companyId, sub.parentOrderId!);
    // Si la original ya no espera el cambio (su sub-orden anterior se anuló y siguió sola), la
    // sub-orden sigue su camino con lo que trajo y nada más.
    if (parent.status !== S.ITEM_CHANGE_REQUESTED) return;

    const kept = (await this.currentItems(manager, parent)).map((item) => ({
      productVariantId: item.productVariantId,
      quantity: item.foundQuantity ?? item.quantity,
      unitPrice: item.unitPrice,
      discountAmount: item.discountAmount,
      notes: `Se queda de #${parent.orderNumber}`,
    }));
    const brought = (await this.currentItems(manager, sub)).map(lineOf);

    await this.stock.release(manager, parent.id);
    await this.newVersion(manager, sub, `Se suma lo que el cliente se queda de #${parent.orderNumber}`, [...brought, ...kept], actorId);
    await this.stock.reserveAt(manager, companyId, sub, sub.destinationLocationId, quantitiesOf(await this.currentItems(manager, sub)), actorId);
    await this.setStatus(
      manager,
      parent,
      S.CLOSED_BY_CHANGE,
      actorId,
      `Cambio resuelto en #${sub.orderNumber} · terminada sin cobro: el cliente paga allá`,
      parent.destinationLocationId,
    );
    await signalInternalOrderChange(manager, this.notifications, companyId, parent, actorId);
  }

  // Una RE que cierra en bodega cierra también la SO que se devolvía (si era una devolución por "no
  // compra"; la RE de un cambio de pedido no toca a su SO, que sigue hacia el pago).
  private async closeReturnedSale(manager: EntityManager, companyId: string, ret: InternalOrder, actorId: string): Promise<void> {
    if (!ret.relatedOrderId) return;
    const sale = await this.lock(manager, companyId, ret.relatedOrderId);
    if (sale.status !== S.RETURN_REQUESTED || sale.relatedOrderId !== ret.id) return;
    await this.setStatus(manager, sale, S.RETURNED, actorId, `Devolución #${ret.orderNumber} recibida en bodega · orden cerrada`, ret.destinationLocationId);
    await signalInternalOrderChange(manager, this.notifications, companyId, sale, actorId);
  }

  // ─── Cambio de pedido ──────────────────────────────────────────────────────────────────────

  // El cliente pide otra talla, otro color u otro producto de lo que ya tiene en la mano. Nunca se
  // sobrescribe nada: la SO pasa a una versión nueva (con lo que se queda) y a ITEM_CHANGE_REQUESTED;
  // lo que se cambia vuelve a bodega en una RE, y lo nuevo viene en una sub-orden desde la bodega
  // elegida, con su propio consecutivo, su corredor y su recorrido completo.
  //
  // Al llegar esa sub-orden se le suma lo que el cliente se quedó y es ella la que se cobra en caja
  // (`absorbParent`); la original termina ahí, sin cobro. Mientras tanto la original guarda lo que
  // se queda: si la sub-orden se anula, vuelve a manos del vendedor con eso y se cobra como siempre.
  async requestChange(companyId: string, actor: OrderActor, input: InternalOrderChangeInput): Promise<InternalOrder> {
    if (!this.has(actor, [PermissionCode.ORDERS_CONFIRM_RECEIPT, PermissionCode.ORDERS_REQUEST_FROM_WAREHOUSE])) {
      throw new ForbiddenException('No tienes permiso para cambiar un pedido');
    }
    return this.dataSource.transaction(async (manager) => {
      const order = await this.lock(manager, companyId, input.orderId);
      if (order.type !== InternalOrderType.SO) throw new ConflictException('Solo una orden de venta admite cambio de pedido');
      if (order.status !== S.RECEIVED_BY_SELLER && order.status !== S.DELIVERED_TO_STORE) {
        throw new ConflictException('El cambio de pedido se pide cuando el producto ya llegó a la tienda');
      }
      await this.assertCanSee(manager, companyId, actor, order);
      await assertStoreAccess(manager, actor.userId, order.destinationLocationId);
      await this.assertNoOpenSale(manager, order);
      const dispatch = await this.activeLocation(manager, companyId, input.sourceLocationId);
      if (dispatch.type !== LocationType.WAREHOUSE) throw new BadRequestException(`${dispatch.name} no es una bodega`);

      if (order.status === S.DELIVERED_TO_STORE) {
        await this.handOver(manager, companyId, order, quantitiesOf(await this.currentItems(manager, order)), actor.userId);
        order.receivedBy = actor.userId;
        await this.setStatus(manager, order, S.RECEIVED_BY_SELLER, actor.userId, 'Vendedor confirma recepción', order.destinationLocationId);
      }
      // Si es la sub-orden de un cambio anterior, primero se queda con lo de su original: el cliente
      // puede cambiar cualquier cosa de lo que tiene en la mano, no solo lo que trajo esta.
      if (order.parentOrderId) await this.absorbParent(manager, companyId, order, actor.userId);

      const items = await this.currentItems(manager, order);
      const byId = new Map(items.map((item) => [item.id, item]));
      const changed = new Set<string>();
      const outgoing: InternalOrderItem[] = [];
      const incoming: NewLine[] = [];
      const variants = await this.variantsById(manager, companyId, input.lines.map((line) => line.productVariantId));
      for (const line of input.lines) {
        const item = byId.get(line.itemId);
        if (!item) throw new NotFoundException(`Línea ${line.itemId} no está en la versión vigente de la orden`);
        if (changed.has(item.id)) throw new BadRequestException('Una misma línea solo se cambia una vez por pedido de cambio');
        if (line.productVariantId === item.productVariantId) throw new BadRequestException('La referencia nueva tiene que ser distinta de la que se cambia');
        const variant = variants.get(line.productVariantId);
        if (!variant) throw new NotFoundException(`Variante ${line.productVariantId} no encontrada`);
        changed.add(item.id);
        outgoing.push(item);
        const quantity = new Decimal(line.quantity);
        if (quantity.lessThanOrEqualTo(0)) throw new BadRequestException('La cantidad de cada línea nueva debe ser mayor que cero');
        incoming.push({
          productVariantId: variant.id,
          quantity,
          unitPrice: variant.price,
          discountAmount: new Decimal(0),
          notes: `Cambio de ${describeVariant(item.productVariant)} → ${describeVariant(variant)}`,
        });
      }
      if (outgoing.length === 0) throw new BadRequestException('Marca al menos una línea para cambiar');

      // Lo que el cliente cambia queda en el cajón de devoluciones de la tienda (no vuelve solo a bodega).
      await this.stock.release(manager, order.id);
      await this.returnsBin.hold(manager, companyId, {
        storeId: order.destinationLocationId,
        origin: { id: order.id, number: order.orderNumber },
        quantities: quantitiesOf(outgoing),
        actorId: actor.userId,
        notify: true,
      });
      const sub = await this.createOrder(manager, companyId, actor.userId, {
        type: InternalOrderType.SO,
        origin: order.origin,
        priority: InternalOrderPriority.HIGH,
        sourceLocationId: dispatch.id,
        destinationLocationId: order.destinationLocationId,
        deliveryPoint: order.deliveryPoint,
        requestedBy: order.requestedBy,
        parentOrderId: order.id,
        relatedOrderId: null,
        notes: `Sub-orden de cambio de #${order.orderNumber}`,
        reason: `Sub-orden de cambio de #${order.orderNumber}`,
        createdDetail: `Sub-orden creada desde #${order.orderNumber} · ${incoming.length} ${incoming.length === 1 ? 'referencia' : 'referencias'} en ${dispatch.name}`,
        createdAt: order.destinationLocationId,
        lines: incoming,
      });
      await this.stock.reserveAt(manager, companyId, sub, dispatch.id, quantitiesOf(await this.currentItems(manager, sub)), actor.userId);

      const kept = items.filter((item) => !changed.has(item.id));
      await this.newVersion(manager, order, `Cambio de pedido · lo cambiado al cajón y llega en #${sub.orderNumber}`, kept.map(lineOf), actor.userId);
      await this.stock.reserveAt(manager, companyId, order, order.destinationLocationId, quantitiesOf(await this.currentItems(manager, order)), actor.userId);
      await this.setStatus(
        manager,
        order,
        S.ITEM_CHANGE_REQUESTED,
        actor.userId,
        `Cliente solicita cambio · lo cambiado queda en el cajón de devoluciones y llega en #${sub.orderNumber} desde ${dispatch.name}`,
        order.destinationLocationId,
      );

      await notifyInternalOrder(manager, this.notifications, companyId, sub, NotificationType.ORDER_REQUESTED, ['WAREHOUSE'], actor.userId);
      for (const touched of [order, sub]) {
        await signalInternalOrderChange(manager, this.notifications, companyId, touched, actor.userId);
      }
      return order;
    });
  }

  // ─── Retorno a bodega por error ────────────────────────────────────────────────────────────

  async reportCorrection(companyId: string, actor: OrderActor, orderId: string, itemIds: string[], description: string): Promise<InternalOrder> {
    if (!this.has(actor, [PermissionCode.ORDERS_CONFIRM_RECEIPT, PermissionCode.WAREHOUSE_FULFILL_ORDERS])) {
      throw new ForbiddenException('No tienes permiso para registrar un retorno por error');
    }
    const text = description.trim();
    if (!text) throw new BadRequestException('Describe qué pasó');
    const ids = [...new Set(itemIds)];
    if (ids.length === 0) throw new BadRequestException('Señala cuáles llegaron mal');
    return this.dataSource.transaction(async (manager) => {
      const order = await this.lock(manager, companyId, orderId);
      await this.assertCanSee(manager, companyId, actor, order);
      if (order.type !== InternalOrderType.SO || (order.status !== S.DELIVERED_TO_STORE && order.status !== S.RECEIVED_BY_SELLER)) {
        throw new ConflictException('El retorno por error se registra cuando la orden ya llegó a la tienda');
      }
      const latest = await manager.getRepository(InternalOrderCorrection).findOne({
        where: { internalOrderId: order.id },
        order: { createdAt: 'DESC' },
      });
      if (latest && !latest.closedAt) throw new ConflictException('Esta orden ya tiene una corrección en curso');
      // Cuáles líneas llegaron equivocadas: son las que el corredor devuelve y las que bodega vuelve a
      // alistar, así que las señala quien reporta y no se deducen. Van en el orden de la orden, no en
      // el que se hayan ido marcando.
      const current = await this.currentItems(manager, order);
      const missing = ids.find((id) => !current.some((line) => line.id === id));
      if (missing) throw new NotFoundException(`Línea ${missing} no está en la versión vigente de la orden`);
      const items = current.filter((line) => ids.includes(line.id));
      const what = linesLabel(items);

      const incidentRepo = manager.getRepository(Incident);
      const incident = await incidentRepo.save(
        incidentRepo.create({
          companyId,
          type: IncidentType.WRONG_VARIANT,
          status: IncidentStatus.OPEN,
          title: (items.length === 1
            ? `Referencia equivocada en la orden #${order.orderNumber}`
            : `${items.length} referencias equivocadas en la orden #${order.orderNumber}`
          ).slice(0, 150),
          description: `${what} · ${text}`.slice(0, 500),
          entityType: ORDER_INCIDENT_ENTITY,
          entityId: order.id,
          locationId: order.sourceLocationId,
          // Con una sola referencia la novedad apunta a su variante; con varias no hay una sola.
          productVariantId: items.length === 1 ? items[0].productVariantId : null,
          reportedBy: actor.userId,
          resolvedBy: null,
          resolvedAt: null,
        }),
      );
      const repo = manager.getRepository(InternalOrderCorrection);
      const correction = await repo.save(
        repo.create({
          internalOrderId: order.id,
          versionNumber: order.versionNumber,
          description: text.slice(0, 500),
          reportedBy: actor.userId,
          runnerId: order.runnerId,
          step: 0,
          incidentId: incident.id,
        }),
      );
      const lineRepo = manager.getRepository(InternalOrderCorrectionItem);
      await lineRepo.save(items.map((item) => lineRepo.create({ correctionId: correction.id, internalOrderItemId: item.id })));
      await this.addEvent(
        manager,
        order,
        InternalOrderEventKind.CORRECTION,
        actor.userId,
        `Retorno a bodega por error · ${what} · ${text}`.slice(0, 500),
        order.destinationLocationId,
      );
      await notifyInternalOrder(manager, this.notifications, companyId, order, NotificationType.ORDER_CORRECTION, ['RUNNERS', 'WAREHOUSE'], actor.userId, {
        notes: `${what} · ${text}`,
      });
      await signalInternalOrderChange(manager, this.notifications, companyId, order, actor.userId);
      return order;
    });
  }

  // Avanza la corrección una parada: llegó a bodega → salió con lo correcto → el vendedor lo recibió.
  async advanceCorrection(companyId: string, actor: OrderActor, orderId: string): Promise<InternalOrder> {
    if (
      !this.has(actor, [
        PermissionCode.RUNNER_PICKUP_ORDERS,
        PermissionCode.RUNNER_CONFIRM_DELIVERY,
        PermissionCode.WAREHOUSE_FULFILL_ORDERS,
        PermissionCode.ORDERS_CONFIRM_RECEIPT,
      ])
    ) {
      throw new ForbiddenException('No tienes permiso para avanzar la corrección');
    }
    return this.dataSource.transaction(async (manager) => {
      const order = await this.lock(manager, companyId, orderId);
      await this.assertCanSee(manager, companyId, actor, order);
      const repo = manager.getRepository(InternalOrderCorrection);
      const correction = await repo.findOne({ where: { internalOrderId: order.id }, order: { createdAt: 'DESC' } });
      if (!correction || correction.closedAt) throw new ConflictException('Esta orden no tiene una corrección en curso');

      const now = new Date();
      const isRunner = this.has(actor, [PermissionCode.RUNNER_PICKUP_ORDERS, PermissionCode.RUNNER_CONFIRM_DELIVERY]);
      if (isRunner) correction.runnerId ??= actor.userId;
      const stops = [
        { field: 'arrivedAtWarehouseAt', detail: `El corredor llegó a ${await this.locationName(manager, order.sourceLocationId)} con la referencia equivocada`, at: order.sourceLocationId },
        { field: 'leftWarehouseAt', detail: `El corredor salió de ${await this.locationName(manager, order.sourceLocationId)} con la referencia correcta`, at: order.sourceLocationId },
        { field: 'closedAt', detail: 'El vendedor recibió la referencia correcta · corrección cerrada', at: order.destinationLocationId },
      ] as const;
      const stop = stops[correction.step];
      correction[stop.field] = now;
      correction.step += 1;
      await repo.save(correction);
      await this.addEvent(manager, order, InternalOrderEventKind.CORRECTION, actor.userId, stop.detail, stop.at);
      await signalInternalOrderChange(manager, this.notifications, companyId, order, actor.userId);
      return order;
    });
  }

  // ─── Avisos del vendedor ───────────────────────────────────────────────────────────────────

  // "Apurar pedido", "Consultar a bodega", "Contactar al corredor": no cambian la orden, dejan su
  // rastro en la bitácora y un aviso a quien tiene que responder.
  async nudge(companyId: string, actor: OrderActor, orderId: string, kind: InternalOrderNudge, message?: string): Promise<InternalOrder> {
    return this.dataSource.transaction(async (manager) => {
      const order = await this.lock(manager, companyId, orderId);
      await this.assertCanSee(manager, companyId, actor, order);
      if (order.requestedBy !== actor.userId && !this.has(actor, [PermissionCode.ORDERS_CONFIRM_RECEIPT])) {
        throw new ForbiddenException('Solo quien pidió la orden puede hacer esto');
      }
      if (isFinalStatus(order.status)) throw new ConflictException('La orden ya está cerrada');
      const note = message?.trim() || null;
      if (kind === InternalOrderNudge.CALL_RUNNER) {
        if (!order.runnerId) throw new ConflictException('Esta orden todavía no tiene corredor');
        // Después de que el destino confirma, el corredor ya no responde por la orden (salvo un
        // retorno por error en curso, que vuelve a moverlo).
        if (!RUNNER_ENGAGED_STATUSES.includes(order.status) && !(await this.hasOpenCorrection(manager, order))) {
          throw new ConflictException('El corredor ya entregó esta orden y se confirmó el recibo');
        }
        await this.addEvent(manager, order, InternalOrderEventKind.NUDGE, actor.userId, `Se contactó al corredor${note ? ` · ${note}` : ''}`, order.destinationLocationId);
        await notifyInternalOrder(manager, this.notifications, companyId, order, NotificationType.ORDER_RUNNER_CALLED, ['RUNNER'], actor.userId, { notes: note });
      } else {
        // Tomada por un corredor pero sin recoger, bodega todavía la tiene: aún se le puede avisar.
        if (PICKED_UP_STATUSES.includes(order.status)) throw new ConflictException('La orden ya va con el corredor');
        const hurry = kind === InternalOrderNudge.HURRY;
        if (hurry) order.priority = InternalOrderPriority.HIGH;
        await manager.getRepository(InternalOrder).save(order);
        await this.addEvent(
          manager,
          order,
          InternalOrderEventKind.NUDGE,
          actor.userId,
          `${hurry ? 'Pedido apurado · el cliente está esperando' : 'Consulta a bodega por la existencia'}${note ? ` · ${note}` : ''}`,
          order.destinationLocationId,
        );
        await notifyInternalOrder(
          manager,
          this.notifications,
          companyId,
          order,
          hurry ? NotificationType.ORDER_HURRY : NotificationType.ORDER_STOCK_QUESTION,
          ['WAREHOUSE'],
          actor.userId,
          { notes: note },
        );
      }
      await signalInternalOrderChange(manager, this.notifications, companyId, order, actor.userId);
      return order;
    });
  }

  // ─── El corredor toma una orden ────────────────────────────────────────────────────────────

  // El corredor se la asigna mientras espera en bodega (no cambia el estado: queda en la bitácora).
  // Desde ahí solo él la recoge. Tomarla otra vez es inofensivo.
  async claim(companyId: string, actor: OrderActor, orderId: string): Promise<InternalOrder> {
    if (!this.has(actor, [PermissionCode.RUNNER_PICKUP_ORDERS])) throw new ForbiddenException('No tienes permiso para tomar órdenes');
    return this.dataSource.transaction(async (manager) => {
      const order = await this.lock(manager, companyId, orderId);
      await this.assertCanSee(manager, companyId, actor, order);
      if (!WAITING_RUNNER_STATUSES.includes(order.status)) throw new ConflictException(`La orden #${order.orderNumber} no está esperando corredor`);
      if (order.runnerId === actor.userId) return order;
      if (order.runnerId) throw new ConflictException(`Otro corredor ya tomó la orden #${order.orderNumber}`);

      order.runnerId = actor.userId;
      await manager.getRepository(InternalOrder).save(order);
      await this.addEvent(manager, order, InternalOrderEventKind.NOTE, actor.userId, `${await this.nameOf(manager, actor.userId)} tomó la orden`, order.sourceLocationId);
      await signalInternalOrderChange(manager, this.notifications, companyId, order, actor.userId);
      return order;
    });
  }

  // ─── Novedades de una orden ────────────────────────────────────────────────────────────────

  // Reporta una novedad sobre la orden o una de sus líneas vigentes (faltante, daño, problema al
  // recoger o al entregar). Usa el modelo general de novedades; no cambia el estado de la orden.
  async reportIncident(companyId: string, actor: OrderActor, input: OrderIncidentReport): Promise<InternalOrder> {
    if (!this.has(actor, INCIDENT_REPORTERS)) throw new ForbiddenException('No tienes permiso para reportar novedades de órdenes');
    if (!ORDER_INCIDENT_TYPES.includes(input.type)) throw new BadRequestException('Ese tipo de novedad no aplica a una orden');
    const text = input.description.trim();
    if (!text) throw new BadRequestException('Describe qué pasó');
    return this.dataSource.transaction(async (manager) => {
      const order = await this.lock(manager, companyId, input.orderId);
      await this.assertCanSee(manager, companyId, actor, order);
      if (isFinalStatus(order.status)) throw new ConflictException('La orden ya está cerrada');
      const item = input.itemId ? (await this.currentItems(manager, order)).find((line) => line.id === input.itemId) : undefined;
      if (input.itemId && !item) throw new NotFoundException(`Línea ${input.itemId} no está en la versión vigente de la orden`);

      const title = `${INCIDENT_TITLES[input.type] ?? 'Novedad'} · #${order.orderNumber}`;
      const repo = manager.getRepository(Incident);
      await repo.save(
        repo.create({
          companyId,
          type: input.type,
          status: IncidentStatus.OPEN,
          title,
          description: text.slice(0, 500),
          entityType: item ? ORDER_ITEM_INCIDENT_ENTITY : ORDER_INCIDENT_ENTITY,
          entityId: item ? item.id : order.id,
          // Antes de salir de bodega pasa en el origen; después, en el destino.
          locationId: PICKED_UP_STATUSES.includes(order.status) ? order.destinationLocationId : order.sourceLocationId,
          productVariantId: item?.productVariantId ?? null,
          reportedBy: actor.userId,
          resolvedBy: null,
          resolvedAt: null,
        }),
      );
      await this.addEvent(manager, order, InternalOrderEventKind.NOTE, actor.userId, `Novedad reportada · ${title} · ${text}`, order.destinationLocationId);
      await signalInternalOrderChange(manager, this.notifications, companyId, order, actor.userId);
      return order;
    });
  }

  // ─── Cajón de devoluciones ─────────────────────────────────────────────────────────────────

  // El administrador manda a bodega lo que se acumuló en el cajón de una tienda: una RE de la tienda a
  // la bodega que elija, con las cantidades que marcó (salen del cajón y quedan apartadas para la RE).
  // Nace esperando corredor y sigue el camino de siempre (recoger, entregar, verificar, cerrar).
  async createReturnFromBin(
    companyId: string,
    actor: OrderActor,
    input: { storeId: string; warehouseId: string; lines: { productVariantId: string; quantity: string }[] },
  ): Promise<InternalOrder> {
    if (!actor.isAdmin) throw new ForbiddenException('Solo el administrador manda a bodega el cajón de devoluciones');
    return this.dataSource.transaction(async (manager) => {
      const store = await this.activeLocation(manager, companyId, input.storeId);
      const warehouse = await this.activeLocation(manager, companyId, input.warehouseId);
      if (store.type !== LocationType.STORE) throw new BadRequestException(`${store.name} no es una tienda`);
      if (warehouse.type !== LocationType.WAREHOUSE) throw new BadRequestException(`${warehouse.name} no es una bodega`);
      const merged = mergeLines(input.lines);
      if (merged.length === 0) throw new BadRequestException('Marca al menos una referencia del cajón');

      const quantities = new Map(merged.map((line) => [line.productVariantId, line.quantity]));
      const origins = await this.returnsBin.take(manager, companyId, store.id, quantities);
      const lines = await this.pricedLines(manager, companyId, InternalOrderType.RE, merged);
      const ret = await this.createOrder(manager, companyId, actor.userId, {
        type: InternalOrderType.RE,
        origin: InternalOrderOrigin.ADMIN,
        priority: InternalOrderPriority.NORMAL,
        sourceLocationId: store.id,
        destinationLocationId: warehouse.id,
        deliveryPoint: null,
        requestedBy: actor.userId,
        parentOrderId: null,
        relatedOrderId: null,
        notes: `Cajón de devoluciones de ${store.name}${origins.length > 0 ? ` · ${origins.map((number) => `#${number}`).join(', ')}` : ''}`.slice(0, 500),
        reason: `Cajón de devoluciones de ${store.name}`,
        createdDetail: `Devolución creada desde el cajón de ${store.name} hacia ${warehouse.name}`,
        createdAt: store.id,
        lines,
      });
      await this.stock.reserveAt(manager, companyId, ret, store.id, quantities, actor.userId);
      await this.setStatus(manager, ret, S.WAITING_FOR_RUNNER, actor.userId, 'Notificación enviada a corredores', store.id);
      await notifyInternalOrder(manager, this.notifications, companyId, ret, NotificationType.ORDER_READY_FOR_RUNNER, ['RUNNERS'], actor.userId, {
        locationId: store.id,
      });
      await signalInternalOrderChange(manager, this.notifications, companyId, ret, actor.userId);
      return ret;
    });
  }

  // Lo que hay en el cajón de devoluciones de cada tienda (solo el administrador lo ve).
  async returnsBinContents(companyId: string, actor: OrderActor) {
    if (!actor.isAdmin) throw new ForbiddenException('Solo el administrador ve el cajón de devoluciones');
    const rows = await this.returnsBin.contents(companyId);
    return rows.map((row) => {
      const variant = row.productVariant;
      return {
        id: row.id,
        storeId: row.inventoryLocation.locationId ?? '',
        storeName: row.inventoryLocation.location?.name ?? 'Tienda',
        productVariantId: row.productVariantId,
        variant: variant?.product
          ? {
              sku: variant.sku,
              productName: variant.product.name,
              reference: variant.product.reference,
              colorName: variant.color.name,
              colorHex: variant.color.hex,
              sizeName: variant.size.name,
              imageUrl: variant.imageUrl,
            }
          : null,
        quantity: row.quantity.toFixed(2),
        sourceNumber: row.sourceNumber,
        addedByName: row.reservedByUser ? `${row.reservedByUser.firstName} ${row.reservedByUser.lastName}`.trim() : null,
        createdAt: row.createdAt,
      };
    });
  }

  // Lo que trajo una orden de venta, por variante (lo encontrado si se alistó): con esto Venta sabe
  // cuánto de lo que caja quitó de su cobro va al cajón de devoluciones.
  async orderedQuantities(manager: EntityManager, companyId: string, orderId: string): Promise<VariantQuantities> {
    const order = await manager.getRepository(InternalOrder).findOneByOrFail({ id: orderId, companyId });
    return quantitiesOf(await this.currentItems(manager, order));
  }

  // ─── El corredor responde dónde va ─────────────────────────────────────────────────────────

  // La respuesta a "Contactar al corredor": dónde va o cuánto le falta. No cambia la orden; queda en la
  // bitácora y le llega a quien la pidió. Solo el corredor de la orden (o el super admin) y mientras
  // responde por ella.
  async runnerReply(companyId: string, actor: OrderActor, orderId: string, message: string): Promise<InternalOrder> {
    const text = message.trim();
    if (!text) throw new BadRequestException('Escribe dónde vas');
    return this.dataSource.transaction(async (manager) => {
      const order = await this.lock(manager, companyId, orderId);
      await this.assertCanSee(manager, companyId, actor, order);
      if (order.runnerId !== actor.userId && !actor.isSuperAdmin) throw new ForbiddenException('Solo el corredor de la orden puede responder');
      if (!RUNNER_ENGAGED_STATUSES.includes(order.status) && !(await this.hasOpenCorrection(manager, order))) {
        throw new ConflictException('Ya entregaste esta orden y se confirmó el recibo');
      }
      await this.addEvent(manager, order, InternalOrderEventKind.NUDGE, actor.userId, `Respuesta del corredor · ${text}`, null);
      await notifyInternalOrder(manager, this.notifications, companyId, order, NotificationType.ORDER_RUNNER_REPLIED, ['REQUESTER'], actor.userId, {
        notes: text,
      });
      await signalInternalOrderChange(manager, this.notifications, companyId, order, actor.userId);
      return order;
    });
  }

  // ─── Cobro en caja (lo usan SaleService, SalePaymentService y CashSessionService) ─────────────

  // La SO que se va a cobrar, bloqueada, con sus líneas vigentes. Solo una SO original que el
  // vendedor ya mandó a caja.
  async lockForCheckout(
    manager: EntityManager,
    companyId: string,
    orderId: string,
  ): Promise<{ order: InternalOrder; items: InternalOrderItem[] }> {
    const order = await this.lock(manager, companyId, orderId);
    if (order.type !== InternalOrderType.SO || order.status !== S.PENDING_PAYMENT) {
      throw new ConflictException(`La orden #${order.orderNumber} no está pendiente de pago`);
    }
    const items = await manager.find(InternalOrderItem, {
      where: { internalOrderId: order.id, versionNumber: order.versionNumber },
      relations: ITEM_RELATIONS,
      order: { createdAt: 'ASC' },
    });
    return { order, items };
  }

  // La caja tomó la orden: lo apartado para el cliente pasa a la venta (que lo vuelve a apartar, en
  // la misma tienda, como suyo).
  async releaseForSale(manager: EntityManager, order: InternalOrder, actorId: string): Promise<void> {
    await this.stock.release(manager, order.id);
    await this.addEvent(manager, order, InternalOrderEventKind.NOTE, actorId, 'Caja abrió el cobro de la orden', order.destinationLocationId);
  }

  // La venta que la cobraba se cobró: la SO queda pagada y ligada a ella.
  async markPaid(manager: EntityManager, companyId: string, orderId: string, sale: Sale, actorId: string): Promise<void> {
    const order = await this.lock(manager, companyId, orderId);
    if (order.status !== S.PENDING_PAYMENT) throw new ConflictException(`La orden #${order.orderNumber} no está pendiente de pago`);
    order.saleId = sale.id;
    await this.setStatus(manager, order, S.PAID, actorId, `Pago registrado en caja · comprobante ${sale.saleNumber ?? ''}`.trim(), order.destinationLocationId);
    await signalInternalOrderChange(manager, this.notifications, companyId, order, actorId);
  }

  // La venta que la cobraba se anuló (en Venta, o al cerrar el turno): la orden sigue por cobrar y
  // lo suyo vuelve a quedar apartado en la tienda para el cliente. Lo que caja había quitado de ese
  // cobro sale del cajón de devoluciones: vuelve a ser de la orden.
  async restoreAfterSaleDiscarded(manager: EntityManager, companyId: string, orderId: string, actorId: string, saleId: string): Promise<void> {
    await this.returnsBin.release(manager, saleId);
    const order = await this.lock(manager, companyId, orderId);
    if (order.status !== S.PENDING_PAYMENT) return;
    const items = await this.currentItems(manager, order);
    await this.stock.reserveAt(manager, companyId, order, order.destinationLocationId, quantitiesOf(items), actorId);
    await this.addEvent(manager, order, InternalOrderEventKind.NOTE, actorId, 'Caja anuló el cobro en curso · la orden sigue pendiente de pago', order.destinationLocationId);
    await signalInternalOrderChange(manager, this.notifications, companyId, order, actorId);
  }

  // ─── Ayudas ────────────────────────────────────────────────────────────────────────────────

  private async createOrder(
    manager: EntityManager,
    companyId: string,
    actorId: string,
    data: {
      type: InternalOrderType;
      origin: InternalOrderOrigin;
      priority: InternalOrderPriority;
      sourceLocationId: string;
      destinationLocationId: string;
      deliveryPoint: string | null;
      requestedBy: string | null;
      parentOrderId: string | null;
      relatedOrderId: string | null;
      notes: string | null;
      reason: string;
      createdDetail: string;
      // dónde se pidió (la sede en que queda el primer evento)
      createdAt: string;
      lines: NewLine[];
    },
  ): Promise<InternalOrder> {
    if (data.lines.length === 0) throw new BadRequestException('La orden necesita al menos una línea');
    const number = await this.sequences.next(manager, companyId, INTERNAL_ORDER_SERIES[data.type]);
    const repo = manager.getRepository(InternalOrder);
    const status = INITIAL_STATUS[data.type];
    const order = await repo.save(
      repo.create({
        companyId,
        orderNumber: formatInternalOrderNumber(data.type, number),
        versionNumber: 1,
        type: data.type,
        origin: data.origin,
        priority: data.priority,
        status,
        statusChangedAt: new Date(),
        sourceLocationId: data.sourceLocationId,
        destinationLocationId: data.destinationLocationId,
        deliveryPoint: data.deliveryPoint,
        requestedBy: data.requestedBy,
        warehouseOperatorId: null,
        runnerId: null,
        receivedBy: null,
        parentOrderId: data.parentOrderId,
        relatedOrderId: data.relatedOrderId,
        saleId: null,
        notes: data.notes,
        cancelledAt: null,
        cancelledBy: null,
        cancellationReason: null,
      }),
    );
    await this.saveVersion(manager, order, data.reason, data.lines, actorId);
    await this.addEvent(manager, order, InternalOrderEventKind.STATUS, actorId, data.createdDetail, data.createdAt, { from: null, to: status });
    return order;
  }


  // Sube de versión con estas líneas; la versión anterior y sus líneas quedan intactas.
  private async newVersion(manager: EntityManager, order: InternalOrder, reason: string, lines: NewLine[] | InternalOrderItem[], actorId: string): Promise<void> {
    order.versionNumber += 1;
    await manager.getRepository(InternalOrder).save(order);
    const fresh = (lines as (NewLine | InternalOrderItem)[]).map((line) => ('id' in line ? lineOf(line) : line));
    await this.saveVersion(manager, order, reason, fresh, actorId);
    await this.addEvent(manager, order, InternalOrderEventKind.VERSION, actorId, `Versión v${order.versionNumber} · ${reason}`, order.destinationLocationId);
  }

  private async saveVersion(manager: EntityManager, order: InternalOrder, reason: string, lines: NewLine[], actorId: string): Promise<void> {
    const versionRepo = manager.getRepository(InternalOrderVersion);
    await versionRepo.save(
      versionRepo.create({
        internalOrderId: order.id,
        versionNumber: order.versionNumber,
        reason: reason.slice(0, 255),
        createdBy: actorId,
        sourceLocationId: order.sourceLocationId,
      }),
    );
    const itemRepo = manager.getRepository(InternalOrderItem);
    await itemRepo.save(
      lines.map((line) =>
        itemRepo.create({
          internalOrderId: order.id,
          versionNumber: order.versionNumber,
          productVariantId: line.productVariantId,
          quantity: line.quantity,
          foundQuantity: null,
          incidentId: null,
          unitPrice: line.unitPrice,
          discountAmount: line.discountAmount,
          notes: line.notes?.slice(0, 255) ?? null,
        }),
      ),
    );
  }

  private async setStatus(
    manager: EntityManager,
    order: InternalOrder,
    to: S,
    actorId: string,
    detail: string,
    locationId: string | null,
  ): Promise<void> {
    const from = order.status;
    order.status = to;
    order.statusChangedAt = new Date();
    await manager.getRepository(InternalOrder).save(order);
    await this.addEvent(manager, order, InternalOrderEventKind.STATUS, actorId, detail, locationId, { from, to });
  }

  private async addEvent(
    manager: EntityManager,
    order: InternalOrder,
    kind: InternalOrderEventKind,
    actorId: string,
    detail: string,
    locationId: string | null,
    status: { from: S | null; to: S } | null = null,
  ): Promise<void> {
    const repo = manager.getRepository(InternalOrderEvent);
    await repo.save(
      repo.create({
        internalOrderId: order.id,
        versionNumber: order.versionNumber,
        kind,
        fromStatus: status?.from ?? null,
        toStatus: status?.to ?? null,
        locationId,
        actorId,
        detail: detail.slice(0, 500),
      }),
    );
  }

  // Guarda lo encontrado (READY) o lo contado (VERIFY) por línea; sin dato, la línea vale lo pedido.
  // Cada línea por debajo abre su novedad. Devuelve cuántas líneas no cuadraron.
  private async recordCounts(
    manager: EntityManager,
    companyId: string,
    order: InternalOrder,
    items: InternalOrderItem[],
    counts: InternalOrderLineCountInput[] | undefined,
    actorId: string,
    mode: 'READY' | 'VERIFY',
  ): Promise<number> {
    const byId = new Map((counts ?? []).map((count) => [count.itemId, new Decimal(count.quantity)]));
    for (const id of byId.keys()) {
      if (!items.some((item) => item.id === id)) throw new NotFoundException(`Línea ${id} no está en la versión vigente de la orden`);
    }
    let mismatches = 0;
    const itemRepo = manager.getRepository(InternalOrderItem);
    for (const item of items) {
      const counted = byId.get(item.id) ?? item.quantity;
      if (counted.greaterThan(item.quantity)) throw new BadRequestException('No se puede registrar más de lo que tiene la línea');
      item.foundQuantity = counted;
      if (counted.lessThan(item.quantity)) {
        mismatches += 1;
        const incidentRepo = manager.getRepository(Incident);
        const incident = await incidentRepo.save(
          incidentRepo.create({
            companyId,
            type: mode === 'READY' ? IncidentType.INSUFFICIENT_STOCK : IncidentType.DELIVERY_ISSUE,
            status: IncidentStatus.OPEN,
            title: mode === 'READY' ? `Faltante en la orden #${order.orderNumber}` : `La devolución #${order.orderNumber} llegó incompleta`,
            description: `Se esperaban ${item.quantity.toFixed(2)} y ${mode === 'READY' ? 'se encontraron' : 'llegaron'} ${counted.toFixed(2)}`,
            entityType: ORDER_ITEM_INCIDENT_ENTITY,
            entityId: item.id,
            locationId: mode === 'READY' ? order.sourceLocationId : order.destinationLocationId,
            productVariantId: item.productVariantId,
            reportedBy: actorId,
            resolvedBy: null,
            resolvedAt: null,
          }),
        );
        item.incidentId = incident.id;
      }
      await itemRepo.save(item);
    }
    return mismatches;
  }

  private async hasOpenCorrection(manager: EntityManager, order: InternalOrder): Promise<boolean> {
    const latest = await manager.getRepository(InternalOrderCorrection).findOne({ where: { internalOrderId: order.id }, order: { createdAt: 'DESC' } });
    return !!latest && !latest.closedAt;
  }

  private async assertNoOpenSale(manager: EntityManager, order: InternalOrder): Promise<void> {
    const open = await manager.getRepository(Sale).existsBy({ internalOrderId: order.id, status: SaleStatus.DRAFT });
    if (open) throw new ConflictException('Caja tiene abierto el cobro de esta orden: anúlalo en Venta primero');
  }

  private async currentItems(manager: EntityManager, order: InternalOrder): Promise<InternalOrderItem[]> {
    return manager.find(InternalOrderItem, {
      where: { internalOrderId: order.id, versionNumber: order.versionNumber },
      relations: ITEM_RELATIONS,
      order: { createdAt: 'ASC' },
    });
  }

  // Las líneas pedidas con su precio: en una SO, el de la variante hoy (lo que el cliente paga); en
  // los demás tipos no hay precio.
  private async pricedLines(
    manager: EntityManager,
    companyId: string,
    type: InternalOrderType,
    items: { productVariantId: string; quantity: Decimal; notes: string | null }[],
  ): Promise<NewLine[]> {
    const variants = await this.variantsById(manager, companyId, items.map((item) => item.productVariantId));
    return items.map((item) => {
      const variant = variants.get(item.productVariantId);
      if (!variant) throw new NotFoundException(`Variante ${item.productVariantId} no encontrada`);
      return {
        productVariantId: variant.id,
        quantity: item.quantity,
        unitPrice: type === InternalOrderType.SO ? variant.price : null,
        discountAmount: new Decimal(0),
        notes: item.notes,
      };
    });
  }

  private async variantsById(manager: EntityManager, companyId: string, ids: string[]): Promise<Map<string, ProductVariant>> {
    if (ids.length === 0) return new Map();
    const variants = await manager.find(ProductVariant, {
      where: { id: In(ids), companyId, status: RecordStatus.ACTIVE },
      relations: { product: true, color: true, size: true },
    });
    return new Map(variants.map((variant) => [variant.id, variant]));
  }

  private async activeLocation(manager: EntityManager, companyId: string, id: string): Promise<Location> {
    const location = await manager.getRepository(Location).findOneBy({ id, companyId });
    if (!location) throw new NotFoundException(`Sede ${id} no encontrada`);
    if (location.status !== RecordStatus.ACTIVE) throw new ConflictException(`${location.name} está desactivada`);
    return location;
  }

  private async lock(manager: EntityManager, companyId: string, id: string): Promise<InternalOrder> {
    const order = await manager.getRepository(InternalOrder).findOne({ where: { id, companyId }, lock: { mode: 'pessimistic_write' } });
    if (!order) throw new NotFoundException(`Orden ${id} no encontrada`);
    return order;
  }

  private async nameOf(manager: EntityManager, userId: string): Promise<string> {
    const user = await manager.getRepository(User).findOneBy({ id: userId });
    return user ? `${user.firstName} ${user.lastName}`.trim() : 'Sin nombre';
  }

  private async locationName(manager: EntityManager, id: string): Promise<string> {
    return (await manager.getRepository(Location).findOneBy({ id }))?.name ?? 'el destino';
  }

  private has(actor: OrderActor, permissions: readonly string[]): boolean {
    return actor.isSuperAdmin || permissions.some((permission) => actor.permissionCodes.includes(permission));
  }

  private async visibilityOf(manager: EntityManager, companyId: string, actor: OrderActor): Promise<OrderVisibility> {
    const locationIds = actor.isSuperAdmin ? [] : await this.accessibleLocationIds(manager, companyId, actor);
    return visibilityOf(actor, locationIds);
  }

  private async canSee(companyId: string, actor: OrderActor, order: InternalOrder): Promise<boolean> {
    return canSeeOrder(await this.visibilityOf(this.dataSource.manager, companyId, actor), order);
  }

  // Quien no ve la orden tampoco la mueve: para él no existe.
  private async assertCanSee(manager: EntityManager, companyId: string, actor: OrderActor, order: InternalOrder): Promise<void> {
    if (!canSeeOrder(await this.visibilityOf(manager, companyId, actor), order)) throw new NotFoundException(`Orden ${order.id} no encontrada`);
  }

  private async accessibleLocationIds(manager: EntityManager, companyId: string, actor: OrderActor): Promise<string[]> {
    const rows = await manager.getRepository(UserLocationAccess).find({
      where: { userId: actor.userId, status: RecordStatus.ACTIVE, location: { companyId } },
    });
    return rows.map((row) => row.locationId);
  }

  // Líneas vigentes, bitácora, correcciones y número de venta de un lote de órdenes, en pocas consultas.
  private async hydrate(manager: EntityManager, orders: InternalOrder[]): Promise<InternalOrderView[]> {
    if (orders.length === 0) return [];
    const ids = orders.map((order) => order.id);
    const items = await manager.find(InternalOrderItem, { where: { internalOrderId: In(ids) }, relations: ITEM_RELATIONS, order: { createdAt: 'ASC' } });
    const events = await manager.find(InternalOrderEvent, {
      where: { internalOrderId: In(ids) },
      relations: { location: true, actor: true },
      order: { createdAt: 'ASC' },
    });
    const corrections = await manager.find(InternalOrderCorrection, {
      where: { internalOrderId: In(ids) },
      relations: { reportedByUser: true, runner: true },
      order: { createdAt: 'ASC' },
    });
    const incidents = await this.incidentsOf(manager, ids, items);
    const orderOfItem = new Map(items.map((item) => [item.id, item.internalOrderId]));
    // Las líneas que llegaron equivocadas en cada corrección: pueden ser de una versión anterior, así
    // que se buscan entre todas las líneas ya cargadas y no solo entre las vigentes.
    const itemById = new Map(items.map((item) => [item.id, item]));
    const correctionLines =
      corrections.length === 0
        ? []
        : await manager.find(InternalOrderCorrectionItem, {
            where: { correctionId: In(corrections.map((correction) => correction.id)) },
            order: { createdAt: 'ASC' },
          });
    const wrongItems = new Map<string, InternalOrderItem[]>();
    for (const line of correctionLines) {
      const item = itemById.get(line.internalOrderItemId);
      if (item) wrongItems.set(line.correctionId, [...(wrongItems.get(line.correctionId) ?? []), item]);
    }
    const incidentOrder = (incident: Incident) =>
      incident.entityType === ORDER_INCIDENT_ENTITY ? incident.entityId : orderOfItem.get(incident.entityId ?? '');
    const saleIds = orders.map((order) => order.saleId).filter((id): id is string => !!id);
    const sales = saleIds.length > 0 ? await manager.find(Sale, { select: { id: true, saleNumber: true }, where: { id: In(saleIds) } }) : [];
    const saleNumbers = new Map(sales.map((sale) => [sale.id, sale.saleNumber]));

    return orders.map((order) =>
      Object.assign(order, {
        items: items.filter((item) => item.internalOrderId === order.id && item.versionNumber === order.versionNumber),
        events: events.filter((event) => event.internalOrderId === order.id),
        corrections: corrections
          .filter((correction) => correction.internalOrderId === order.id)
          .map((correction) => Object.assign(correction, { items: wrongItems.get(correction.id) ?? [] })),
        incidents: incidents.filter((incident) => incidentOrder(incident) === order.id),
        saleNumber: order.saleId ? (saleNumbers.get(order.saleId) ?? null) : null,
      }),
    );
  }

  // Las novedades ligadas a las órdenes o a cualquiera de sus líneas (de todas las versiones).
  private incidentsOf(manager: EntityManager, orderIds: string[], items: InternalOrderItem[]): Promise<Incident[]> {
    const itemIds = items.map((item) => item.id);
    return manager
      .getRepository(Incident)
      .createQueryBuilder('incident')
      .where(
        new Brackets((where) => {
          where.where('(incident.entityType = :orderEntity AND incident.entityId IN (:...orderIds))', { orderEntity: ORDER_INCIDENT_ENTITY, orderIds });
          if (itemIds.length > 0) {
            where.orWhere('(incident.entityType = :itemEntity AND incident.entityId IN (:...itemIds))', { itemEntity: ORDER_ITEM_INCIDENT_ENTITY, itemIds });
          }
        }),
      )
      .orderBy('incident.createdAt', 'ASC')
      .getMany();
  }
}

// Una línea por guardar en una versión.
interface NewLine {
  productVariantId: string;
  quantity: Decimal;
  unitPrice: Decimal | null;
  discountAmount: Decimal;
  notes: string | null;
}

// La misma línea, para copiarla a una versión nueva: lleva lo que de verdad se mueve (lo encontrado,
// si ya se alistó) y su precio.
function lineOf(item: InternalOrderItem): NewLine {
  return {
    productVariantId: item.productVariantId,
    quantity: item.foundQuantity ?? item.quantity,
    unitPrice: item.unitPrice,
    discountAmount: item.discountAmount,
    notes: null,
  };
}

// Una variante repetida en varias líneas se pide una sola vez, sumada.
function mergeLines(items: { productVariantId: string; quantity: string; notes?: string }[]) {
  const merged = new Map<string, { productVariantId: string; quantity: Decimal; notes: string | null }>();
  for (const item of items) {
    const quantity = new Decimal(item.quantity);
    if (quantity.lessThanOrEqualTo(0)) throw new BadRequestException('La cantidad de cada línea debe ser mayor que cero');
    const current = merged.get(item.productVariantId);
    if (current) current.quantity = current.quantity.plus(quantity);
    else merged.set(item.productVariantId, { productVariantId: item.productVariantId, quantity, notes: item.notes?.trim() || null });
  }
  return [...merged.values()];
}

// "Air Force 1 Blanco / 40".
function describeVariant(variant: ProductVariant | undefined): string {
  if (!variant) return 'otra referencia';
  return `${variant.product?.name ?? ''} ${variant.color?.name ?? ''} / ${variant.size?.name ?? ''}`.trim();
}
