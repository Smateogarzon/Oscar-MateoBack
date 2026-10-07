import { BadRequestException, ConflictException, ForbiddenException, Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Decimal } from 'decimal.js';
import { DataSource, EntityManager, In, Repository } from 'typeorm';
import { assertStoreAccess } from '../../common/access/store-access.js';
import { RecordStatus } from '../../common/enums/record-status.enum.js';
import { CashActor } from '../cash-session/cash-actor.js';
import { CashSessionService } from '../cash-session/cash-session.service.js';
import { withdrawDiscountRequests } from '../discount-request/discount-request-cleanup.js';
import { DiscountRequestStatus } from '../discount-request/entities/discount-request-status.enum.js';
import { runIdempotent } from '../idempotency/idempotency.js';
import { InventoryBalanceService } from '../inventory-balance/inventory-balance.service.js';
import { InventoryMovementType } from '../inventory-movement/entities/inventory-movement-type.enum.js';
import { InventorySourceType } from '../inventory-movement/entities/inventory-source-type.enum.js';
import { InventoryMovementService } from '../inventory-movement/inventory-movement.service.js';
import { InventoryReservationService } from '../inventory-reservation/inventory-reservation.service.js';
import { releaseReservations } from '../inventory-reservation/reserved-quantity.js';
import { NotificationService } from '../notification/notification.service.js';
import { validatePaymentMethods } from '../payment-method/payment-method-validation.js';
import { SaleItemType } from '../sale/entities/sale-item-type.enum.js';
import { SaleItem } from '../sale/entities/sale-item.entity.js';
import { SaleStatus } from '../sale/entities/sale-status.enum.js';
import { Sale } from '../sale/entities/sale.entity.js';
import { SaleActor } from '../sale/sale-actor.js';
import { SaleService } from '../sale/sale.service.js';
import { InternalOrderService } from '../internal-order/internal-order.service.js';
import { StorePaymentMethod } from '../store-payment-method/entities/store-payment-method.entity.js';
import { SaleReturnService } from '../sale-return/sale-return.service.js';
import { CompleteSaleInput } from './dto/complete-sale.input.js';
import { SalePayment } from './entities/sale-payment.entity.js';

// Los pagos ya interpretados: importes como Decimal y la referencia recortada (o null)
interface ParsedPayment {
  paymentMethodId: string;
  amount: Decimal;
  reference: string | null;
}

// Cobrar una venta y dejarla completada. La empresa de un pago es la de su venta: todo se hace
// dentro de la empresa activa y una venta de otra empresa se responde como si no existiera.
@Injectable()
export class SalePaymentService {
  constructor(
    @InjectRepository(SalePayment)
    private readonly salePaymentRepository: Repository<SalePayment>,
    private readonly dataSource: DataSource,
    private readonly sales: SaleService,
    private readonly internalOrders: InternalOrderService,
    private readonly cashSessions: CashSessionService,
    private readonly returns: SaleReturnService,
    private readonly notifications: NotificationService,
    private readonly inventoryBalances: InventoryBalanceService,
    private readonly inventoryMovements: InventoryMovementService,
    private readonly reservations: InventoryReservationService,
  ) {}

  // En el orden en que se registraron. La empresa y quién puede verlos se comprueban a través de la
  // venta: los pagos de una venta ajena se responden como si no existieran.
  async findAll(companyId: string, actor: SaleActor, saleId: string): Promise<SalePayment[]> {
    await this.sales.findVisible(companyId, actor, saleId);
    return this.salePaymentRepository.find({ where: { saleId }, order: { createdAt: 'ASC' } });
  }

  // Completa una venta en borrador: guarda todos sus pagos, la deja COMPLETADA y la ata al turno
  // de caja en que se cobró. Todo o nada, en una transacción. Se exige que:
  //   - la venta tenga líneas
  //   - el turno esté abierto, sea de una caja de la misma tienda y lo opere su cajero asignado
  //     (CashSessionService.lockOpen)
  //   - cada medio de pago sea activo y de la empresa, y traiga referencia si la exige
  //   - los pagos sumen EXACTAMENTE lo que hay que cobrar: el total de la venta, menos el crédito
  //     de una devolución si esta es la venta nueva de un cambio (`saleReturnId`). El crédito cubre
  //     hasta lo que valió lo devuelto; los pagos pueden ir vacíos si alcanza para todo. El vuelto
  //     de un pago en efectivo de más lo maneja quien cobra y no se guarda.
  // Primero se bloquea la venta, después la devolución (si hay) y por último el turno, siempre en
  // ese orden, para no cruzar bloqueos.
  //
  // Cobrar es idempotente: si la venta ya se cobró con estos mismos pagos y por este mismo cajero (el
  // cajero reintenta porque la respuesta se perdió, o hizo doble clic), se devuelve la venta ya cobrada
  // en vez de rechazar con "solo se modifica un borrador". Con `idempotencyKey` la garantía es
  // explícita y no depende de que los datos coincidan; sin ella, la coincidencia de pagos basta.
  async complete(
    companyId: string,
    actor: CashActor,
    input: CompleteSaleInput,
    idempotencyKey?: string,
  ): Promise<Sale> {
    const payments: ParsedPayment[] = input.payments.map((payment) => ({
      paymentMethodId: payment.paymentMethodId,
      amount: new Decimal(payment.amount),
      reference: payment.reference?.trim() || null,
    }));
    if (payments.length === 0 && !input.saleReturnId) {
      throw new BadRequestException('Indica al menos un pago');
    }
    if (payments.some((payment) => payment.amount.lessThanOrEqualTo(0))) {
      throw new BadRequestException('Cada pago debe ser mayor que cero');
    }

    return this.dataSource.transaction((manager) =>
      runIdempotent(
        manager,
        {
          companyId,
          userId: actor.userId,
          operation: 'completeSale',
          key: idempotencyKey,
          input,
          resourceType: 'sale',
        },
        () => this.completeInTransaction(manager, companyId, actor, input, payments),
        (id) => manager.getRepository(Sale).findOneByOrFail({ id }),
      ),
    );
  }

  private async completeInTransaction(
    manager: EntityManager,
    companyId: string,
    actor: CashActor,
    input: CompleteSaleInput,
    payments: ParsedPayment[],
  ): Promise<Sale> {
    const sale = await this.sales.lockAnyStatus(manager, companyId, input.saleId);

    // Un reintento: ya se cobró, con estos pagos y por este cajero. No se cobra dos veces.
    if (sale.status === SaleStatus.COMPLETED) {
      if (await this.isSameCompletion(manager, sale, actor, payments)) return sale;
      throw new ConflictException('Solo se puede modificar una venta en borrador');
    }
    if (sale.status !== SaleStatus.DRAFT) {
      throw new ConflictException('Solo se puede modificar una venta en borrador');
    }

    // La venta la cobra normalmente su cajero (el del turno asignado), pero quien abre y cierra
    // turnos (actor.canManageShifts, permiso cash.open_close_shift) también puede cobrarla: interviene
    // cualquier caja sin tener que asignársela primero.
    if (!actor.canManageShifts && sale.cashierId !== actor.userId) {
      throw new ForbiddenException('Solo el cajero de la venta puede cobrarla');
    }
    // Cobrar es operar en la tienda: hace falta seguir teniendo acceso a ella, no basta con
    // haberlo tenido cuando se abrió la venta.
    await assertStoreAccess(manager, actor.userId, sale.storeId);

    // Cobrar con una solicitud todavía pendiente no espera a que la resuelvan: se cobra al total
    // de hoy (sin ese descuento, que solo se aplica al aprobarla) y la solicitud se retira sola,
    // para que no quede pendiente sobre una venta ya cerrada. Una ya aprobada no se toca: su
    // descuento ya está aplicado en los totales que se cobran abajo.
    await withdrawDiscountRequests(manager, this.notifications, {
      companyId,
      saleIds: [sale.id],
      statuses: [DiscountRequestStatus.PENDING],
      actorId: actor.userId,
      note: 'Retirada automáticamente: la venta se cobró antes de resolverla',
    });

    const hasLines = await manager.getRepository(SaleItem).existsBy({ saleId: sale.id });
    if (!hasLines) throw new BadRequestException('La venta no tiene líneas para cobrar');

    // Se cobra lo que suman las líneas hoy, no lo que haya quedado guardado.
    await this.sales.recalculate(manager, sale);
    if (sale.total.lessThanOrEqualTo(0)) {
      throw new BadRequestException('La venta no tiene nada que cobrar');
    }

    // Si es un cambio, el crédito de la devolución paga hasta lo que valió lo devuelto.
    const exchange = input.saleReturnId
      ? await this.returns.lockForExchange(manager, companyId, input.saleReturnId)
      : null;
    const credit = exchange ? Decimal.min(exchange.totalReturned, sale.total) : new Decimal(0);

    // El turno ya es el que se le asignó a la venta al crearla: se vuelve a bloquear para
    // revalidar que siga abierto (si se cerró entre que se creó y ahora, no se cobra).
    if (!sale.cashSessionId) throw new ConflictException('La venta no tiene un turno asociado: no se puede cobrar');
    const session = await this.cashSessions.lockOpen(manager, companyId, sale.cashSessionId, actor);
    if (session.cashRegister.storeId !== sale.storeId) {
      throw new ConflictException('El turno es de una caja de otra tienda');
    }

    const methodsById = await validatePaymentMethods(manager, companyId, payments);
    const methods = [...methodsById.values()];

    // Cada tienda elige con qué se cobra en ella (Configuración → Medios de pago por tienda).
    if (methods.length > 0) {
      const methodIds = [...methodsById.keys()];
      const allowed = await manager.getRepository(StorePaymentMethod).find({
        where: { storeId: sale.storeId, paymentMethodId: In(methodIds), status: RecordStatus.ACTIVE },
        select: { paymentMethodId: true },
      });
      const allowedIds = new Set(allowed.map((row) => row.paymentMethodId));
      const refused = methods.find((method) => !allowedIds.has(method.id));
      if (refused) {
        throw new ConflictException(`Esta tienda no acepta ${refused.name}: elige otro medio de pago`);
      }
    }

    const paid = payments.reduce((sum, payment) => sum.plus(payment.amount), new Decimal(0));
    const due = sale.total.minus(credit);
    if (!paid.equals(due)) {
      throw new BadRequestException(
        credit.isZero()
          ? `Los pagos suman ${paid.toFixed(2)} y la venta vale ${sale.total.toFixed(2)}: tienen que ser iguales`
          : `Los pagos suman ${paid.toFixed(2)} y hay que cobrar ${due.toFixed(2)} (la venta vale ${sale.total.toFixed(2)} y el crédito de la devolución cubre ${credit.toFixed(2)})`,
      );
    }

    if (payments.length > 0) {
      const paymentRepo = manager.getRepository(SalePayment);
      await paymentRepo.save(
        payments.map((payment) =>
          paymentRepo.create({
            saleId: sale.id,
            paymentMethodId: payment.paymentMethodId,
            amount: payment.amount,
            reference: payment.reference,
            receivedBy: actor.userId,
          }),
        ),
      );
    }

    // El consecutivo se pide al final, con todo lo demás ya validado: un cobro que falla no gasta número.
    await this.sales.assignNumber(manager, companyId, sale);

    // Las líneas de catálogo (ver AddSaleItemInput.productVariantId) descuentan de la bodega STOCK
    // donde esa variante esté registrada — no necesariamente la de la tienda que vendió: en esta
    // empresa el punto de venta no tiene existencia física propia, todo viaja desde bodegas
    // satélite (más adelante lo trae un corredor, ver InventoryLocationType.RUNNER; ese flujo todavía
    // no existe). Se hace en la misma transacción del cobro: si no hay existencia en ninguna
    // bodega, el cobro entero se revierte. Las líneas GENERIC no tocan inventario.
    const items = await manager.getRepository(SaleItem).find({ where: { saleId: sale.id } });
    const inventoried = items.filter((item) => item.type === SaleItemType.INVENTORIED && item.productVariantId);

    // La venta viene apartando lo suyo desde que se armó (SaleService.syncReservations): se descuenta
    // de la MISMA bodega donde quedó apartado, no de la que más tenga hoy, que podría ser otra.
    const held = await this.reservations.findForSource(manager, InventorySourceType.SALE, sale.id);
    const heldByVariant = new Map(held.map((reservation) => [reservation.productVariantId, reservation]));

    // Y se suelta lo propio antes de mover: si no, la venta se bloquearía a sí misma al descontar
    // (lo apartado no se puede sacar; ver InventoryMovementService). Lo que apartan OTRAS ventas en
    // curso sigue en pie y sí protege sus unidades.
    await releaseReservations(manager, InventorySourceType.SALE, [sale.id]);

    for (const item of inventoried) {
      // Sin reserva solo quedan los borradores de antes de que las ventas apartaran: se elige bodega
      // como se hacía entonces.
      const reserved = heldByVariant.get(item.productVariantId!);
      const fromLocationId =
        reserved?.inventoryLocationId ??
        (await this.inventoryBalances.findStockLocationForSale(
          manager,
          companyId,
          item.productVariantId!,
          item.quantity,
        ));
      await this.inventoryMovements.recordInTransaction(manager, companyId, actor.userId, {
        productVariantId: item.productVariantId!,
        fromLocationId,
        quantity: item.quantity,
        type: InventoryMovementType.SALE,
        sourceType: InventorySourceType.SALE,
        sourceId: sale.id,
        sourceNumber: sale.saleNumber,
      });
    }

    sale.status = SaleStatus.COMPLETED;
    sale.completedAt = new Date();
    sale.cashSessionId = session.id;
    sale.returnCredit = credit;
    const completed = await manager.getRepository(Sale).save(sale);

    if (exchange) await this.returns.applyExchange(manager, exchange, completed, credit);
    // La venta cobraba una orden de venta (SO): la orden queda pagada y ligada a esta venta.
    if (completed.internalOrderId) {
      await this.internalOrders.markPaid(manager, companyId, completed.internalOrderId, completed, actor.userId);
    }
    return completed;
  }

  // ¿La venta ya cobrada quedó con exactamente estos pagos y los recibió este cajero? Entonces lo que
  // llega es un reintento del mismo cobro, no un intento de cobrar otra vez con otros datos. Compara
  // medio, importe y referencia sin importar el orden.
  private async isSameCompletion(
    manager: EntityManager,
    sale: Sale,
    actor: CashActor,
    payments: ParsedPayment[],
  ): Promise<boolean> {
    if (!actor.canManageShifts && sale.cashierId !== actor.userId) return false;

    const stored = await manager.getRepository(SalePayment).find({ where: { saleId: sale.id } });
    if (stored.length !== payments.length) return false;
    if (stored.some((payment) => payment.receivedBy !== actor.userId)) return false;

    const keyOf = (methodId: string, amount: Decimal, reference: string | null) =>
      `${methodId}|${amount.toFixed(2)}|${reference ?? ''}`;

    const pending = new Map<string, number>();
    for (const payment of stored) {
      const key = keyOf(payment.paymentMethodId, payment.amount, payment.reference);
      pending.set(key, (pending.get(key) ?? 0) + 1);
    }
    for (const payment of payments) {
      const key = keyOf(payment.paymentMethodId, payment.amount, payment.reference);
      const left = pending.get(key) ?? 0;
      if (left === 0) return false;
      pending.set(key, left - 1);
    }
    return true;
  }
}
