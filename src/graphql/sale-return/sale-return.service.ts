import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Decimal } from 'decimal.js';
import { DataSource, EntityManager, In, Not, Repository } from 'typeorm';
import { PermissionCode } from '../../common/enums/permission-code.enum.js';
import { CashActor } from '../cash-session/cash-actor.js';
import { CashSessionService } from '../cash-session/cash-session.service.js';
import { DocumentSequenceService } from '../document-sequence/document-sequence.service.js';
import { NotificationChannel } from '../notification/entities/notification-channel.enum.js';
import { NotificationEntityType } from '../notification/entities/notification-entity-type.enum.js';
import { NotificationType } from '../notification/entities/notification-type.enum.js';
import { NotificationService } from '../notification/notification.service.js';
import { PaymentMethodType } from '../payment-method/entities/payment-method-type.enum.js';
import { validatePaymentMethods } from '../payment-method/payment-method-validation.js';
import { SaleItem } from '../sale/entities/sale-item.entity.js';
import { Sale } from '../sale/entities/sale.entity.js';
import { SaleService } from '../sale/sale.service.js';
import { CompleteReturnRefundInput } from './dto/complete-return-refund.input.js';
import { EditSaleReturnInput } from './dto/edit-sale-return.input.js';
import { RequestSaleReturnInput } from './dto/request-sale-return.input.js';
import { SaleReturnNotesInput } from './dto/sale-return-notes.input.js';
import { RefundPayment } from './entities/refund-payment.entity.js';
import { SaleReturnItem } from './entities/sale-return-item.entity.js';
import { SaleReturnResolution } from './entities/sale-return-resolution.enum.js';
import {
  RESERVING_SALE_RETURN_STATUSES,
  SaleReturnStatus,
} from './entities/sale-return-status.enum.js';
import { SaleReturn } from './entities/sale-return.entity.js';
import { paidPerLine, returnValue } from './return-values.js';
import { formatReturnNumber, RETURN_SERIES } from './sale-return-number.js';

// Flujo de una devolución: el cajero la registra (PENDIENTE), un administrador la aprueba o la
// rechaza, y se completa al entregar el dinero (REFUND) o al cobrar la venta nueva del cambio
// (EXCHANGE, con `completeSale` y el `saleReturnId`). Un cambio por algo más barato pasa a
// PARTIAL_REFUND y queda aprobado hasta entregar la diferencia en dinero. La venta original nunca se
// modifica. La empresa de una devolución es la suya, y una de otra empresa se responde como si no
// existiera.
//
// Bloqueos, siempre en este orden: venta (la original al pedirla, la nueva al cobrar un cambio) →
// devolución → turno de caja. Pedir una devolución bloquea la venta original, y así dos pedidos a la
// vez no devuelven las mismas unidades; lo demás bloquea solo la devolución.
//
// Cada paso avisa a la otra parte (canal Devoluciones, ver NotificationService) dentro de la misma
// transacción: los administradores reciben la devolución nueva y lo que la cancele; quien la
// registró recibe si se modificó, se aprobó, se rechazó o la canceló un administrador. Quien hace la
// acción no se avisa a sí mismo. Al resolverse una devolución, sus avisos de "devolución nueva" pasan
// a leídos para todos los administradores.
@Injectable()
export class SaleReturnService {
  constructor(
    @InjectRepository(SaleReturn)
    private readonly returnRepository: Repository<SaleReturn>,
    @InjectRepository(SaleReturnItem)
    private readonly itemRepository: Repository<SaleReturnItem>,
    @InjectRepository(RefundPayment)
    private readonly refundRepository: Repository<RefundPayment>,
    private readonly dataSource: DataSource,
    private readonly sales: SaleService,
    private readonly sequences: DocumentSequenceService,
    private readonly cashSessions: CashSessionService,
    private readonly notifications: NotificationService,
  ) {}

  // Las más recientes primero.
  findAll(
    companyId: string,
    filters: { status?: SaleReturnStatus; saleId?: string; replacementSaleId?: string } = {},
  ): Promise<SaleReturn[]> {
    const { status, saleId, replacementSaleId } = filters;
    return this.returnRepository.find({
      where: {
        companyId,
        ...(status && { status }),
        ...(saleId && { saleId }),
        ...(replacementSaleId && { replacementSaleId }),
      },
      order: { createdAt: 'DESC' },
    });
  }

  async findOne(companyId: string, id: string): Promise<SaleReturn> {
    const saleReturn = await this.returnRepository.findOneBy({ id, companyId });
    if (!saleReturn) throw new NotFoundException(`Devolución ${id} no encontrada`);
    return saleReturn;
  }

  // Las líneas devueltas, en el orden en que se registraron.
  async findItems(companyId: string, saleReturnId: string): Promise<SaleReturnItem[]> {
    await this.findOne(companyId, saleReturnId);
    return this.itemRepository.find({ where: { saleReturnId }, order: { createdAt: 'ASC' } });
  }

  async findRefunds(companyId: string, saleReturnId: string): Promise<RefundPayment[]> {
    await this.findOne(companyId, saleReturnId);
    return this.refundRepository.find({ where: { saleReturnId }, order: { createdAt: 'ASC' } });
  }

  // Los reembolsos que salieron del cajón en un turno (solo los en efectivo se atan a un turno),
  // en el orden en que se entregaron, cada uno con el número de su devolución. Un turno que quien
  // pregunta no puede ver se responde como si no existiera (misma regla que las ventas y los
  // movimientos del turno): quien cierra o consulta un turno ve sus devoluciones aunque no tenga
  // sales.view, porque ya se le confió el turno.
  async findRefundsInSession(
    companyId: string,
    actor: CashActor,
    cashSessionId: string,
  ): Promise<(RefundPayment & { returnNumber: string })[]> {
    await this.cashSessions.findOne(companyId, actor, cashSessionId);
    const refunds = await this.refundRepository.find({
      where: { cashSessionId },
      relations: { saleReturn: true },
      order: { createdAt: 'ASC' },
    });
    return refunds.map((refund) =>
      Object.assign(refund, { returnNumber: refund.saleReturn.returnNumber }),
    );
  }

  // Registra una devolución de una venta ya cobrada. Lo que vale cada línea devuelta lo calcula el
  // servidor: lo que el cliente realmente pagó, con sus descuentos (ver return-values.ts). No se
  // puede devolver más de lo vendido, contando lo que ya se devolvió en otras devoluciones que
  // siguen vigentes. No cambia nada de la venta original.
  async request(
    companyId: string,
    cashierId: string,
    input: RequestSaleReturnInput,
  ): Promise<SaleReturn> {
    const wanted = this.parseWanted(input.items);
    const reason = input.reason?.trim() || null;

    return this.dataSource.transaction(async (manager) => {
      const sale = await this.sales.lockCompleted(manager, companyId, input.saleId);
      const { items, totalReturned } = await this.priceItems(manager, sale, wanted);

      // El número se pide al final y dentro de la misma transacción: si algo de arriba falla, no se
      // gasta un consecutivo.
      const number = await this.sequences.next(manager, companyId, RETURN_SERIES);

      const repo = manager.getRepository(SaleReturn);
      const saleReturn = await repo.save(
        repo.create({
          companyId,
          saleId: sale.id,
          returnNumber: formatReturnNumber(number),
          resolution: input.resolution,
          totalReturned,
          refundAmount: new Decimal(0),
          status: SaleReturnStatus.PENDING,
          reason,
          processedBy: cashierId,
        }),
      );

      const itemRepo = manager.getRepository(SaleReturnItem);
      await itemRepo.save(
        items.map((item) => itemRepo.create({ saleReturnId: saleReturn.id, ...item })),
      );

      await this.notifyApprovers(manager, companyId, NotificationType.RETURN_REQUESTED, saleReturn, cashierId);
      return saleReturn;
    });
  }

  // Cambia una devolución que todavía está pendiente: qué líneas y cuántas unidades se devuelven, y
  // si el cliente se lleva dinero o un cambio. Es lo que hace un administrador al revisarla cuando
  // solo procede parte de lo que pidió el cajero (por ejemplo, 1 de los 2 productos). Las líneas
  // nuevas reemplazan a las anteriores y se vuelven a valorar como al pedirla, contando lo ya
  // devuelto en OTRAS devoluciones vigentes (no la que se está editando). Una vez aprobada,
  // rechazada o cancelada ya no se toca: se cancela y se pide otra.
  async edit(
    companyId: string,
    editorId: string,
    id: string,
    input: EditSaleReturnInput,
  ): Promise<SaleReturn> {
    const wanted = this.parseWanted(input.items);

    return this.dataSource.transaction(async (manager) => {
      // Se bloquea primero la venta y después la devolución, igual que al pedirla: así una edición y
      // un pedido a la vez sobre la misma venta no devuelven las mismas unidades. Hay que leer la
      // devolución (sin bloquear) para saber cuál es su venta.
      const current = await manager.getRepository(SaleReturn).findOneBy({ id, companyId });
      if (!current) throw new NotFoundException(`Devolución ${id} no encontrada`);
      const sale = await this.sales.lockCompleted(manager, companyId, current.saleId);

      const saleReturn = await this.lock(manager, companyId, id);
      if (saleReturn.status !== SaleReturnStatus.PENDING) {
        throw new ConflictException(
          'Solo se puede modificar una devolución pendiente de aprobación',
        );
      }

      const { items, totalReturned } = await this.priceItems(manager, sale, wanted, saleReturn.id);

      const itemRepo = manager.getRepository(SaleReturnItem);
      await itemRepo.delete({ saleReturnId: saleReturn.id });
      await itemRepo.save(
        items.map((item) => itemRepo.create({ saleReturnId: saleReturn.id, ...item })),
      );

      saleReturn.totalReturned = totalReturned;
      if (input.resolution) saleReturn.resolution = input.resolution;
      if (input.reason !== undefined) saleReturn.reason = input.reason?.trim() || null;
      const saved = await manager.getRepository(SaleReturn).save(saleReturn);

      await this.notifyRequester(manager, companyId, NotificationType.RETURN_EDITED, saleReturn, editorId);
      // Sigue pendiente pero cambió lo que se devuelve: los demás administradores ven su lista al día
      await this.signalApprovers(manager, companyId, saleReturn, editorId);
      return saved;
    });
  }

  // Aprueba una devolución pendiente. Cualquier administrador con el permiso puede aprobar.
  async approve(
    companyId: string,
    adminId: string,
    id: string,
    input: SaleReturnNotesInput,
  ): Promise<SaleReturn> {
    return this.dataSource.transaction(async (manager) => {
      const saleReturn = await this.lock(manager, companyId, id);
      if (saleReturn.status !== SaleReturnStatus.PENDING) {
        throw new ConflictException('La devolución ya fue resuelta');
      }

      saleReturn.status = SaleReturnStatus.APPROVED;
      this.markResolved(saleReturn, adminId, input.notes);
      const saved = await manager.getRepository(SaleReturn).save(saleReturn);

      await this.notifyRequester(manager, companyId, NotificationType.RETURN_APPROVED, saleReturn, adminId);
      await this.clearPendingNotices(manager, companyId, saleReturn, adminId);
      return saved;
    });
  }

  // Rechaza una devolución pendiente: lo devuelto vuelve a quedar disponible para otra.
  async reject(
    companyId: string,
    adminId: string,
    id: string,
    input: SaleReturnNotesInput,
  ): Promise<SaleReturn> {
    return this.dataSource.transaction(async (manager) => {
      const saleReturn = await this.lock(manager, companyId, id);
      if (saleReturn.status !== SaleReturnStatus.PENDING) {
        throw new ConflictException('La devolución ya fue resuelta');
      }

      saleReturn.status = SaleReturnStatus.REJECTED;
      this.markResolved(saleReturn, adminId, input.notes);
      const saved = await manager.getRepository(SaleReturn).save(saleReturn);

      await this.notifyRequester(
        manager,
        companyId,
        NotificationType.RETURN_REJECTED,
        saleReturn,
        adminId,
        saleReturn.resolutionNotes,
      );
      await this.clearPendingNotices(manager, companyId, saleReturn, adminId);
      return saved;
    });
  }

  // Cancela una devolución pendiente o aprobada. La puede cancelar quien la registró o quien puede
  // aprobar (`canApprove`). Si ya se cobró su cambio no se cancela: falta entregar la diferencia.
  async cancel(
    companyId: string,
    userId: string,
    id: string,
    canApprove: boolean,
    input: SaleReturnNotesInput,
  ): Promise<SaleReturn> {
    return this.dataSource.transaction(async (manager) => {
      const saleReturn = await this.lock(manager, companyId, id);

      if (
        saleReturn.status !== SaleReturnStatus.PENDING &&
        saleReturn.status !== SaleReturnStatus.APPROVED
      ) {
        throw new ConflictException('La devolución ya no se puede cancelar');
      }
      if (saleReturn.processedBy !== userId && !canApprove) {
        throw new ForbiddenException(
          'Solo quien la registró o quien aprueba devoluciones puede cancelarla',
        );
      }
      if (saleReturn.replacementSaleId) {
        throw new ConflictException(
          'La devolución ya tiene un cambio cobrado: completa el reembolso de la diferencia',
        );
      }

      const wasPending = saleReturn.status === SaleReturnStatus.PENDING;
      saleReturn.status = SaleReturnStatus.CANCELLED;
      this.markResolved(saleReturn, userId, input.notes);
      const saved = await manager.getRepository(SaleReturn).save(saleReturn);

      // Si la cancela quien la registró se avisa a los administradores; si la cancela un
      // administrador, a quien la registró.
      const type = NotificationType.RETURN_CANCELLED;
      if (userId === saleReturn.processedBy) {
        await this.notifyApprovers(manager, companyId, type, saleReturn, userId, saleReturn.resolutionNotes);
      } else {
        await this.notifyRequester(manager, companyId, type, saleReturn, userId, saleReturn.resolutionNotes);
      }
      if (wasPending) await this.clearPendingNotices(manager, companyId, saleReturn, userId);
      return saved;
    });
  }

  // Entrega el dinero de una devolución aprobada: todo lo devuelto (REFUND) o la diferencia de un
  // cambio por algo más barato (PARTIAL_REFUND). Los reembolsos van juntos y suman EXACTAMENTE lo que
  // hay que devolver. Uno en efectivo sale del cajón, así que necesita un turno abierto asignado a
  // quien lo entrega, igual que cobrar, y baja el efectivo esperado al cerrarlo.
  async completeRefund(
    companyId: string,
    actor: CashActor,
    input: CompleteReturnRefundInput,
  ): Promise<SaleReturn> {
    const payments = input.payments.map((payment) => ({
      paymentMethodId: payment.paymentMethodId,
      amount: new Decimal(payment.amount),
      reference: payment.reference?.trim() || null,
    }));
    if (payments.some((payment) => payment.amount.lessThanOrEqualTo(0))) {
      throw new BadRequestException('Cada reembolso debe ser mayor que cero');
    }

    return this.dataSource.transaction(async (manager) => {
      const saleReturn = await this.lock(manager, companyId, input.saleReturnId);
      this.assertApproved(saleReturn);

      const toRefund = await this.amountToRefund(manager, saleReturn);

      const methodsById = await validatePaymentMethods(manager, companyId, payments);

      const refunded = payments.reduce((sum, payment) => sum.plus(payment.amount), new Decimal(0));
      if (!refunded.equals(toRefund)) {
        throw new BadRequestException(
          `Los reembolsos suman ${refunded.toFixed(2)} y hay que devolver ${toRefund.toFixed(2)}: tienen que ser iguales`,
        );
      }

      // El turno va al final: siempre después de la devolución, nunca antes.
      const paidInCash = payments.some(
        (payment) =>
          methodsById.get(payment.paymentMethodId)?.type === PaymentMethodType.CASH,
      );
      if (paidInCash && !input.cashSessionId) {
        throw new BadRequestException(
          'El reembolso en efectivo sale de un turno de caja: indica el turno',
        );
      }
      const session = input.cashSessionId
        ? await this.cashSessions.lockOpen(manager, companyId, input.cashSessionId, actor)
        : null;

      const refundRepo = manager.getRepository(RefundPayment);
      await refundRepo.save(
        payments.map((payment) =>
          refundRepo.create({
            saleReturnId: saleReturn.id,
            paymentMethodId: payment.paymentMethodId,
            amount: payment.amount,
            reference: payment.reference,
            cashSessionId: session?.id ?? null,
            paidBy: actor.userId,
          }),
        ),
      );

      saleReturn.refundAmount = refunded;
      saleReturn.status = SaleReturnStatus.COMPLETED;
      saleReturn.completedAt = new Date();
      return manager.getRepository(SaleReturn).save(saleReturn);
    });
  }

  // Bloquea la devolución de un cambio que se va a cobrar y exige que pueda usarse: aprobada, de
  // tipo cambio y sin cambio cobrado todavía. Pública porque SalePaymentService la usa al cobrar la
  // venta nueva, con esa venta ya bloqueada y antes del turno de caja.
  async lockForExchange(
    manager: EntityManager,
    companyId: string,
    id: string,
  ): Promise<SaleReturn> {
    const saleReturn = await this.lock(manager, companyId, id);
    if (saleReturn.status !== SaleReturnStatus.APPROVED) {
      throw new ConflictException('La devolución no está aprobada');
    }
    // Un cambio ya cobrado por algo más barato pasó a PARTIAL_REFUND: se le dice que ya se cobró.
    if (saleReturn.replacementSaleId) {
      throw new ConflictException('La devolución ya tiene su cambio cobrado');
    }
    if (saleReturn.resolution !== SaleReturnResolution.EXCHANGE) {
      throw new ConflictException('La devolución no es un cambio');
    }
    return saleReturn;
  }

  // Deja la devolución al día después de cobrar la venta nueva de un cambio, que usó `credit` del
  // crédito de lo devuelto. Si el crédito alcanzó para todo lo devuelto, la devolución termina; si
  // sobró (el cambio era por algo más barato), pasa a PARTIAL_REFUND y sigue aprobada hasta que se
  // entregue la diferencia en dinero. Pública porque SalePaymentService la usa.
  applyExchange(
    manager: EntityManager,
    saleReturn: SaleReturn,
    sale: Sale,
    credit: Decimal,
  ): Promise<SaleReturn> {
    saleReturn.replacementSaleId = sale.id;
    if (credit.lessThan(saleReturn.totalReturned)) {
      saleReturn.resolution = SaleReturnResolution.PARTIAL_REFUND;
    } else {
      saleReturn.status = SaleReturnStatus.COMPLETED;
      saleReturn.completedAt = new Date();
    }
    return manager.getRepository(SaleReturn).save(saleReturn);
  }

  // Las líneas que se piden devolver, ya como números y sin repetidas ni en cero.
  private parseWanted(
    items: { saleItemId: string; quantity: string }[],
  ): { saleItemId: string; quantity: Decimal }[] {
    const wanted = items.map((item) => ({
      saleItemId: item.saleItemId,
      quantity: new Decimal(item.quantity),
    }));
    if (new Set(wanted.map((item) => item.saleItemId)).size !== wanted.length) {
      throw new BadRequestException('Una línea no puede repetirse en la devolución');
    }
    if (wanted.some((item) => item.quantity.lessThanOrEqualTo(0))) {
      throw new BadRequestException('La cantidad a devolver debe ser mayor que cero');
    }
    return wanted;
  }

  // Lo que vale cada línea que se quiere devolver de una venta ya bloqueada: lo que el cliente
  // realmente pagó, con sus descuentos (ver return-values.ts). No deja devolver más de lo vendido,
  // contando lo ya devuelto en las devoluciones vigentes de la venta; `ignoreReturnId` deja fuera
  // una de ellas (la que se está editando, cuyas líneas se van a reemplazar).
  private async priceItems(
    manager: EntityManager,
    sale: Sale,
    wanted: { saleItemId: string; quantity: Decimal }[],
    ignoreReturnId?: string,
  ): Promise<{
    items: { saleItemId: string; quantity: Decimal; amount: Decimal }[];
    totalReturned: Decimal;
  }> {
    // Siempre en el mismo orden: el reparto del descuento general depende de él.
    const lines = await manager
      .getRepository(SaleItem)
      .find({ where: { saleId: sale.id }, order: { createdAt: 'ASC', id: 'ASC' } });
    const linesById = new Map(lines.map((line) => [line.id, line]));
    const paid = paidPerLine(lines, sale.generalDiscount);

    // Lo que ya se devolvió de cada línea, en las devoluciones que siguen vigentes
    const previous = await manager.getRepository(SaleReturnItem).find({
      where: {
        saleReturn: {
          saleId: sale.id,
          status: In(RESERVING_SALE_RETURN_STATUSES),
          ...(ignoreReturnId && { id: Not(ignoreReturnId) }),
        },
      },
    });
    const returned = new Map<string, { quantity: Decimal; amount: Decimal }>();
    for (const item of previous) {
      const before = returned.get(item.saleItemId) ?? {
        quantity: new Decimal(0),
        amount: new Decimal(0),
      };
      returned.set(item.saleItemId, {
        quantity: before.quantity.plus(item.quantity),
        amount: before.amount.plus(item.amount),
      });
    }

    const items = wanted.map((item) => {
      const line = linesById.get(item.saleItemId);
      if (!line) {
        throw new BadRequestException('Alguna de las líneas indicadas no pertenece a la venta');
      }

      const before = returned.get(line.id) ?? { quantity: new Decimal(0), amount: new Decimal(0) };
      const remaining = line.quantity.minus(before.quantity);
      if (item.quantity.greaterThan(remaining)) {
        throw new BadRequestException(
          `No se puede devolver más de lo vendido: de "${line.description}" quedan ${remaining.toFixed(2)} por devolver`,
        );
      }

      return {
        saleItemId: line.id,
        quantity: item.quantity,
        amount: returnValue(
          paid.get(line.id) as Decimal,
          line.quantity,
          before.quantity,
          before.amount,
          item.quantity,
        ),
      };
    });

    const totalReturned = items.reduce((sum, item) => sum.plus(item.amount), new Decimal(0));
    if (totalReturned.lessThanOrEqualTo(0)) {
      throw new BadRequestException('No hay nada que devolver: el valor de lo devuelto es cero');
    }
    return { items, totalReturned };
  }

  private async lock(manager: EntityManager, companyId: string, id: string): Promise<SaleReturn> {
    const saleReturn = await manager.getRepository(SaleReturn).findOne({
      where: { id, companyId },
      lock: { mode: 'pessimistic_write' },
    });
    if (!saleReturn) throw new NotFoundException(`Devolución ${id} no encontrada`);
    return saleReturn;
  }

  private assertApproved(saleReturn: SaleReturn): void {
    switch (saleReturn.status) {
      case SaleReturnStatus.APPROVED:
        return;
      case SaleReturnStatus.PENDING:
        throw new ConflictException('La devolución todavía no está aprobada');
      case SaleReturnStatus.COMPLETED:
        throw new ConflictException('La devolución ya está completada');
      default:
        throw new ConflictException('La devolución fue rechazada o cancelada');
    }
  }

  // Lo que hay que devolver en dinero: todo lo devuelto si es REFUND; si es un cambio por algo más
  // barato (PARTIAL_REFUND), lo que sobró del crédito. Un cambio al que le falta cobrar la venta
  // nueva todavía no tiene nada que devolver.
  private async amountToRefund(manager: EntityManager, saleReturn: SaleReturn): Promise<Decimal> {
    if (saleReturn.resolution === SaleReturnResolution.REFUND) return saleReturn.totalReturned;

    if (saleReturn.resolution === SaleReturnResolution.PARTIAL_REFUND) {
      const replacement = await manager
        .getRepository(Sale)
        .findOneBy({ id: saleReturn.replacementSaleId as string });
      if (!replacement) throw new NotFoundException('No se encontró la venta del cambio');
      return saleReturn.totalReturned.minus(replacement.returnCredit);
    }

    throw new ConflictException('Esta devolución es un cambio: falta cobrar la venta nueva');
  }

  private markResolved(saleReturn: SaleReturn, userId: string, notes?: string | null): void {
    saleReturn.resolvedBy = userId;
    saleReturn.resolvedAt = new Date();
    saleReturn.resolutionNotes = notes?.trim() || null;
  }

  // Avisa a quienes aprueban devoluciones en la empresa (menos a quien hizo la acción).
  private async notifyApprovers(
    manager: EntityManager,
    companyId: string,
    type: NotificationType,
    saleReturn: SaleReturn,
    actorId: string,
    notes?: string | null,
  ): Promise<void> {
    const recipientIds = await this.notifications.findUserIdsWithPermission(
      manager,
      companyId,
      PermissionCode.SALES_APPROVE_RETURN,
    );
    await this.notify(manager, companyId, type, saleReturn, actorId, recipientIds, notes);
  }

  // Avisa a quien registró la devolución (si no es quien hizo la acción).
  private notifyRequester(
    manager: EntityManager,
    companyId: string,
    type: NotificationType,
    saleReturn: SaleReturn,
    actorId: string,
    notes?: string | null,
  ): Promise<void> {
    return this.notify(manager, companyId, type, saleReturn, actorId, [saleReturn.processedBy], notes);
  }

  private async notify(
    manager: EntityManager,
    companyId: string,
    type: NotificationType,
    saleReturn: SaleReturn,
    actorId: string,
    recipientIds: string[],
    notes?: string | null,
  ): Promise<void> {
    // La tienda de la venta original, para que el aviso se pueda ubicar por tienda
    const sale = await manager.getRepository(Sale).findOneBy({ id: saleReturn.saleId });
    await this.notifications.notify(manager, {
      companyId,
      type,
      recipientIds,
      actorId,
      entityType: NotificationEntityType.SALE_RETURN,
      entityId: saleReturn.id,
      locationId: sale?.storeId ?? null,
      reference: saleReturn.returnNumber,
      notes,
    });
  }

  // La devolución ya no está pendiente: el aviso de "devolución nueva" deja de esperar respuesta, y a
  // los demás administradores se les avisa en vivo para que su lista de pendientes se ponga al día sola
  // (quien la resolvió ya se refresca con su propia operación).
  private async clearPendingNotices(
    manager: EntityManager,
    companyId: string,
    saleReturn: SaleReturn,
    actorId: string,
  ): Promise<void> {
    await this.notifications.markEntityRead(
      manager,
      NotificationEntityType.SALE_RETURN,
      saleReturn.id,
      [NotificationType.RETURN_REQUESTED],
    );
    await this.signalApprovers(manager, companyId, saleReturn, actorId);
  }

  // Avisa en vivo, sin crear ningún aviso, a los administradores (menos a quien hizo el cambio) de
  // que esta devolución cambió.
  private async signalApprovers(
    manager: EntityManager,
    companyId: string,
    saleReturn: SaleReturn,
    actorId: string,
  ): Promise<void> {
    const approverIds = await this.notifications.findUserIdsWithPermission(
      manager,
      companyId,
      PermissionCode.SALES_APPROVE_RETURN,
    );
    this.notifications.signalChange(manager, {
      companyId,
      channel: NotificationChannel.RETURNS,
      entityType: NotificationEntityType.SALE_RETURN,
      entityId: saleReturn.id,
      recipientIds: approverIds,
      exceptUserId: actorId,
    });
  }
}
