import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Decimal } from 'decimal.js';
import { DataSource, EntityManager, In, Repository } from 'typeorm';
import { assertStoreAccess } from '../../common/access/store-access.js';
import { RecordStatus } from '../../common/enums/record-status.enum.js';
import { CashActor } from '../cash-session/cash-actor.js';
import { CashSessionService } from '../cash-session/cash-session.service.js';
import {
  ACTIVE_DISCOUNT_REQUEST_STATUSES,
  DiscountRequestStatus,
} from '../discount-request/entities/discount-request-status.enum.js';
import { DiscountRequest } from '../discount-request/entities/discount-request.entity.js';
import { DocumentSequenceService } from '../document-sequence/document-sequence.service.js';
import { LocationType } from '../location/entities/location-type.enum.js';
import { Location } from '../location/entities/location.entity.js';
import { User } from '../user/entities/user.entity.js';
import { UserCompanyRole } from '../user-company-role/entities/user-company-role.entity.js';
import { UserLocationAccess } from '../user-location-access/entities/user-location-access.entity.js';
import { AddSaleItemInput } from './dto/add-sale-item.input.js';
import { CancelSaleInput } from './dto/cancel-sale.input.js';
import { CreateSaleInput } from './dto/create-sale.input.js';
import { UpdateSaleItemQuantityInput } from './dto/update-sale-item-quantity.input.js';
import { SaleActor } from './sale-actor.js';
import { SaleItemType } from './entities/sale-item-type.enum.js';
import { SaleItem } from './entities/sale-item.entity.js';
import { SaleStatus } from './entities/sale-status.enum.js';
import { Sale } from './entities/sale.entity.js';
import { formatSaleNumber, SALE_SERIES } from './sale-number.js';
import { calculateLine, calculateSaleTotals, MAX_AMOUNT } from './sale-totals.js';

// Todo se hace dentro de la empresa activa: una venta de otra empresa se responde igual que
// una que no existe. Los totales de la venta nunca los manda el cliente: salen de sus líneas y
// del descuento aprobado (sales.generalDiscount), calculados aquí con Decimal (ver
// sale-totals.ts). El descuento no se aplica directo: lo fija DiscountRequestService al aprobar
// una solicitud.
@Injectable()
export class SaleService {
  constructor(
    @InjectRepository(Sale)
    private readonly saleRepository: Repository<Sale>,
    @InjectRepository(SaleItem)
    private readonly saleItemRepository: Repository<SaleItem>,
    private readonly dataSource: DataSource,
    private readonly sequences: DocumentSequenceService,
    private readonly cashSessions: CashSessionService,
  ) {}

  // Las más recientes primero. Para el histórico de ventas: sin sales.view_all (CashActor.canViewAll)
  // cada quien ve solo las suyas, sea porque las cobró o porque las vendió; con él, ve todas y puede
  // además filtrar por un cajero concreto (`cashierId`).
  findAll(
    companyId: string,
    actor: SaleActor,
    filters: { status?: SaleStatus; storeId?: string; cashierId?: string } = {},
  ): Promise<Sale[]> {
    const { status, storeId, cashierId } = filters;
    const base = { companyId, ...(status && { status }), ...(storeId && { storeId }) };
    const order = { createdAt: 'DESC' as const };

    if (actor.canViewAll) {
      return this.saleRepository.find({ where: { ...base, ...(cashierId && { cashierId }) }, order });
    }
    return this.saleRepository.find({
      where: [
        { ...base, cashierId: actor.userId },
        { ...base, sellerId: actor.userId },
      ],
      order,
    });
  }

  async findOne(companyId: string, id: string): Promise<Sale> {
    const sale = await this.saleRepository.findOneBy({ id, companyId });
    if (!sale) throw new NotFoundException(`Venta ${id} no encontrada`);
    return sale;
  }

  // Las ventas COBRADAS de un turno, para su recibo de cierre: no las canceladas ni las que
  // quedaron en borrador (nunca se cobraron). Un turno que quien pregunta no puede ver se
  // responde como si no existiera (misma regla que CashMovementService.findAll): quien cierra o
  // consulta un turno ve sus ventas aunque no tenga sales.view, porque ya se le confió el turno.
  async findAllInSession(companyId: string, actor: CashActor, cashSessionId: string): Promise<Sale[]> {
    await this.cashSessions.findOne(companyId, actor, cashSessionId);
    return this.saleRepository.find({
      where: { cashSessionId, status: SaleStatus.COMPLETED },
      order: { completedAt: 'ASC' },
    });
  }

  // Las líneas de todas esas ventas, en una sola consulta (no una por venta): las agrupa por
  // venta quien arma el recibo, con `saleId`.
  async findItemsInSession(companyId: string, actor: CashActor, cashSessionId: string): Promise<SaleItem[]> {
    await this.cashSessions.findOne(companyId, actor, cashSessionId);
    return this.saleItemRepository.find({
      where: { sale: { cashSessionId, status: SaleStatus.COMPLETED } },
      order: { createdAt: 'ASC' },
    });
  }

  // En el orden en que se agregaron. La empresa se comprueba a través de la venta.
  async findItems(companyId: string, saleId: string): Promise<SaleItem[]> {
    await this.findOne(companyId, saleId);
    return this.saleItemRepository.find({ where: { saleId }, order: { createdAt: 'ASC' } });
  }

  // Cuántas líneas tiene, para listas de ventas (la cola de "Ventas en curso") que no necesitan
  // traerlas todas.
  countItems(saleId: string): Promise<number> {
    return this.saleItemRepository.count({ where: { saleId } });
  }

  // Crea una venta en borrador: el cajero es quien da "nueva venta". Los totales arrancan en
  // cero y cambian a medida que se agregan líneas. Queda atada al turno indicado desde ya (no
  // solo al cobrarla): así el turno la ve entre sus borradores desde el principio.
  async create(companyId: string, actor: CashActor, input: CreateSaleInput): Promise<Sale> {
    const cashierId = actor.userId;
    return this.dataSource.transaction(async (manager) => {
      // La tienda se busca sin filtrar por estado, a propósito: una desactivada sí existe, y
      // responder "no encontrada" mandaría a buscar el problema donde no está. Una de otra
      // empresa sigue respondiéndose como inexistente (el filtro por `companyId` no se toca).
      const store = await manager.getRepository(Location).findOneBy({
        id: input.storeId,
        companyId,
        type: LocationType.STORE,
      });
      if (!store) throw new NotFoundException(`Tienda ${input.storeId} no encontrada`);
      if (store.status !== RecordStatus.ACTIVE) {
        throw new ConflictException(`La tienda ${store.name} está desactivada: no se puede vender en ella`);
      }

      // Solo se vende desde las tiendas a las que el usuario tiene acceso (Configuración →
      // Personal por ubicación).
      await assertStoreAccess(manager, cashierId, store.id);

      // El turno tiene que estar abierto, ser de una caja de esta tienda y estar asignado a quien
      // crea la venta (lockOpen ya lo exige).
      const session = await this.cashSessions.lockOpen(manager, companyId, input.cashSessionId, actor);
      if (session.cashRegister.storeId !== store.id) {
        throw new ConflictException('El turno es de una caja de otra tienda');
      }

      if (input.sellerId) {
        const sellerIsMember = await manager.getRepository(UserCompanyRole).existsBy({
          userId: input.sellerId,
          companyId,
          status: RecordStatus.ACTIVE,
        });
        // Una membresía activa no basta: la cuenta misma pudo desactivarse sin que se le
        // quitaran sus roles.
        const sellerAccountActive =
          sellerIsMember &&
          (await manager.getRepository(User).existsBy({ id: input.sellerId, status: RecordStatus.ACTIVE }));
        if (!sellerAccountActive) throw new NotFoundException(`Vendedor ${input.sellerId} no encontrado`);
      }

      // El número se pide al final y dentro de la misma transacción: si algo de arriba falla,
      // no se gasta un consecutivo.
      const number = await this.sequences.next(manager, companyId, SALE_SERIES);

      const repo = manager.getRepository(Sale);
      return repo.save(
        repo.create({
          companyId,
          storeId: store.id,
          sellerId: input.sellerId ?? null,
          cashierId,
          cashSessionId: session.id,
          saleNumber: formatSaleNumber(number),
          subtotal: new Decimal(0),
          discountTotal: new Decimal(0),
          generalDiscount: new Decimal(0),
          total: new Decimal(0),
          status: SaleStatus.DRAFT,
        }),
      );
    });
  }

  // Agrega una línea genérica y recalcula los totales de la venta. La línea nace sin descuento:
  // los descuentos solo llegan por una solicitud aprobada. Agregar líneas se puede aunque haya
  // una solicitud activa. Devuelve la venta con sus totales al día.
  async addItem(companyId: string, userId: string, input: AddSaleItemInput): Promise<Sale> {
    const description = input.description.trim();
    if (!description) throw new BadRequestException('La descripción de la línea no puede estar vacía');

    const quantity = new Decimal(input.quantity);
    if (quantity.lessThanOrEqualTo(0)) {
      throw new BadRequestException('La cantidad debe ser mayor que cero');
    }
    const unitPrice = new Decimal(input.unitPrice);
    const discountAmount = new Decimal(0);

    const { gross, total } = calculateLine(quantity, unitPrice, discountAmount);
    if (gross.greaterThanOrEqualTo(MAX_AMOUNT)) {
      throw new BadRequestException('El valor de la línea supera el máximo permitido');
    }

    return this.dataSource.transaction(async (manager) => {
      const sale = await this.lockDraft(manager, companyId, input.saleId);
      await assertStoreAccess(manager, userId, sale.storeId);

      const repo = manager.getRepository(SaleItem);
      await repo.save(
        repo.create({
          saleId: sale.id,
          type: SaleItemType.GENERIC,
          productVariantId: null,
          description,
          sku: input.sku?.trim() || null,
          quantity,
          unitPrice,
          discountAmount,
          total,
        }),
      );

      return this.recalculate(manager, sale);
    });
  }

  // Cambia la cantidad de una línea (no su precio) y recalcula. Igual que al quitar líneas, no se
  // puede mientras haya una solicitud de descuento activa: el monto pedido o aprobado se calculó
  // sobre el valor anterior de la línea y quedaría desfasado. Para cambiarla hay que cancelar la
  // solicitud y pedir otra. Devuelve la venta con sus totales al día.
  async updateItemQuantity(
    companyId: string,
    userId: string,
    input: UpdateSaleItemQuantityInput,
  ): Promise<Sale> {
    const quantity = new Decimal(input.quantity);
    if (quantity.lessThanOrEqualTo(0)) {
      throw new BadRequestException('La cantidad debe ser mayor que cero');
    }

    return this.dataSource.transaction(async (manager) => {
      const sale = await this.lockDraft(manager, companyId, input.saleId);
      await assertStoreAccess(manager, userId, sale.storeId);
      await this.assertNoActiveDiscountRequest(manager, sale.id, 'cambiar cantidades');

      const repo = manager.getRepository(SaleItem);
      const item = await repo.findOneBy({ id: input.itemId, saleId: sale.id });
      if (!item) throw new NotFoundException(`Línea ${input.itemId} no encontrada`);

      const { gross, total } = calculateLine(quantity, item.unitPrice, item.discountAmount);
      if (gross.greaterThanOrEqualTo(MAX_AMOUNT)) {
        throw new BadRequestException('El valor de la línea supera el máximo permitido');
      }

      item.quantity = quantity;
      item.total = total;
      await repo.save(item);

      return this.recalculate(manager, sale);
    });
  }

  // Quita una línea y recalcula. Mientras haya una solicitud de descuento activa no se quitan
  // líneas: el monto pedido o aprobado se calculó sobre ellas y quedaría desfasado. Para
  // cambiarlas hay que cancelar la solicitud y pedir otra.
  async removeItem(companyId: string, userId: string, saleId: string, itemId: string): Promise<Sale> {
    return this.dataSource.transaction(async (manager) => {
      const sale = await this.lockDraft(manager, companyId, saleId);
      await assertStoreAccess(manager, userId, sale.storeId);
      await this.assertNoActiveDiscountRequest(manager, sale.id, 'quitar líneas');

      const repo = manager.getRepository(SaleItem);
      const item = await repo.findOneBy({ id: itemId, saleId: sale.id });
      if (!item) throw new NotFoundException(`Línea ${itemId} no encontrada`);

      await repo.delete(item.id);
      return this.recalculate(manager, sale);
    });
  }

  // Solo se cancela una venta en borrador: una completada ya se cobró (sus pagos están en la caja) y
  // se corrige con una devolución, que llegará con su propio módulo. Deja guardado quién la
  // canceló, cuándo y por qué. Una venta ya cancelada no se cancela dos veces. Su solicitud de
  // descuento activa, si la hay, se cancela con ella: si no, quedaría pendiente para siempre en la
  // lista del administrador.
  async cancel(companyId: string, userId: string, id: string, input: CancelSaleInput): Promise<Sale> {
    const reason = input.reason.trim();
    if (!reason) throw new BadRequestException('Indica el motivo de la cancelación');

    return this.dataSource.transaction(async (manager) => {
      const repo = manager.getRepository(Sale);

      // La fila se bloquea: dos cancelaciones a la vez no se pisan.
      const sale = await repo.findOne({
        where: { id, companyId },
        lock: { mode: 'pessimistic_write' },
      });
      if (!sale) throw new NotFoundException(`Venta ${id} no encontrada`);
      if (sale.status === SaleStatus.CANCELLED) {
        throw new ConflictException('La venta ya está cancelada');
      }
      if (sale.status === SaleStatus.COMPLETED) {
        throw new ConflictException('Una venta completada no se puede cancelar: ya se cobró');
      }

      await manager.getRepository(DiscountRequest).update(
        { saleId: sale.id, status: In(ACTIVE_DISCOUNT_REQUEST_STATUSES) },
        {
          status: DiscountRequestStatus.CANCELLED,
          resolvedBy: userId,
          resolvedAt: new Date(),
          resolutionNotes: 'Venta cancelada',
        },
      );

      sale.status = SaleStatus.CANCELLED;
      sale.cancelledBy = userId;
      sale.cancelledAt = new Date();
      sale.cancellationReason = reason;
      return repo.save(sale);
    });
  }

  // Mientras una solicitud de descuento está activa (pendiente o aprobada) las líneas no cambian
  // de valor ni de número: el monto pedido o aprobado se calculó sobre ellas.
  private async assertNoActiveDiscountRequest(
    manager: EntityManager,
    saleId: string,
    action: string,
  ): Promise<void> {
    const hasActiveRequest = await manager.getRepository(DiscountRequest).existsBy({
      saleId,
      status: In(ACTIVE_DISCOUNT_REQUEST_STATUSES),
    });
    if (hasActiveRequest) {
      throw new ConflictException(
        `La venta tiene una solicitud de descuento activa: cancélala antes de ${action}`,
      );
    }
  }

  // Trae la venta bloqueada hasta que la transacción termine, para que dos cambios a la vez no
  // se pisen, y exige que siga en borrador: una venta completada o cancelada ya no cambia.
  // Es pública porque DiscountRequestService la usa: todo lo que cambia una venta o sus
  // solicitudes ocurre con la venta bloqueada, y por eso nunca se cruzan dos cambios.
  async lockDraft(manager: EntityManager, companyId: string, id: string): Promise<Sale> {
    const sale = await manager.getRepository(Sale).findOne({
      where: { id, companyId },
      lock: { mode: 'pessimistic_write' },
    });
    if (!sale) throw new NotFoundException(`Venta ${id} no encontrada`);
    if (sale.status !== SaleStatus.DRAFT) {
      throw new ConflictException('Solo se puede modificar una venta en borrador');
    }
    return sale;
  }

  // Trae la venta bloqueada y exige que esté completada: es la que se devuelve. La venta no se
  // modifica; el bloqueo solo hace que dos devoluciones de la misma venta no pidan a la vez las
  // mismas unidades. Pública porque SaleReturnService la usa.
  async lockCompleted(manager: EntityManager, companyId: string, id: string): Promise<Sale> {
    const sale = await manager.getRepository(Sale).findOne({
      where: { id, companyId },
      lock: { mode: 'pessimistic_write' },
    });
    if (!sale) throw new NotFoundException(`Venta ${id} no encontrada`);
    if (sale.status !== SaleStatus.COMPLETED) {
      throw new ConflictException('Solo se devuelve una venta completada');
    }
    return sale;
  }

  // Vuelve a calcular subtotal, descuento y total de la venta desde sus líneas y la guarda. Si
  // algo no cuadra lanza un error, y como corre dentro de la transacción del cambio que lo
  // provocó, ese cambio también se deshace. Pública porque DiscountRequestService la usa al
  // aprobar o cancelar un descuento.
  async recalculate(manager: EntityManager, sale: Sale): Promise<Sale> {
    const items = await manager.getRepository(SaleItem).find({ where: { saleId: sale.id } });
    const totals = calculateSaleTotals(items, sale.generalDiscount);

    if (sale.generalDiscount.greaterThan(totals.net)) {
      throw new BadRequestException('El descuento de la venta supera el total de sus líneas');
    }
    if (totals.subtotal.greaterThanOrEqualTo(MAX_AMOUNT)) {
      throw new BadRequestException('El subtotal de la venta supera el máximo permitido');
    }

    sale.subtotal = totals.subtotal;
    sale.discountTotal = totals.discountTotal;
    sale.total = totals.total;
    return manager.getRepository(Sale).save(sale);
  }
}
