import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Decimal } from 'decimal.js';
import { DataSource, EntityManager, FindOptionsWhere, In, Repository } from 'typeorm';
import { assertStoreAccess } from '../../common/access/store-access.js';
import { PermissionCode } from '../../common/enums/permission-code.enum.js';
import { runIdempotent } from '../idempotency/idempotency.js';
import { NotificationChannel } from '../notification/entities/notification-channel.enum.js';
import { NotificationEntityType } from '../notification/entities/notification-entity-type.enum.js';
import { NotificationType } from '../notification/entities/notification-type.enum.js';
import { NotificationService } from '../notification/notification.service.js';
import { SaleItem } from '../sale/entities/sale-item.entity.js';
import { Sale } from '../sale/entities/sale.entity.js';
import { canReadSale, SaleActor } from '../sale/sale-actor.js';
import { SaleService } from '../sale/sale.service.js';
import { ApproveDiscountRequestInput } from './dto/approve-discount-request.input.js';
import { DiscountRequestNotesInput } from './dto/discount-request-notes.input.js';
import { RequestDiscountInput } from './dto/request-discount.input.js';
import { lineGross, MAX_DISCOUNT_PERCENT, maxDiscountFor } from './discount-rules.js';
import {
  ACTIVE_DISCOUNT_REQUEST_STATUSES,
  DiscountRequestStatus,
} from './entities/discount-request-status.enum.js';
import { DiscountRequestItem } from './entities/discount-request-item.entity.js';
import { DiscountRequest } from './entities/discount-request.entity.js';

// Cuántas solicitudes devuelve la lista de una vez: por defecto y como máximo (las más recientes).
export const DEFAULT_REQUESTS_LIMIT = 500;
export const MAX_REQUESTS_LIMIT = 1000;

// Flujo de un descuento: el cajero lo solicita, un administrador lo aprueba (con los montos que
// decida) o lo rechaza, y solo el aprobado descuenta. Un administrador también puede editar los
// montos de un descuento ya aprobado. Una venta tiene a lo sumo UNA solicitud activa (pendiente
// o aprobada): rechazada o cancelada, se puede pedir otra.
//
// La solicitud es sobre toda la venta (un monto) o sobre líneas (un monto por línea). Nadie, ni un
// administrador, pasa del 30 % del valor de la venta o de la línea (ver discount-rules.ts).
// Al aprobarse, el descuento de cada línea se escribe en la línea (sale_items.discountAmount) y el
// de toda la venta en sales.generalDiscount, y los totales se recalculan.
//
// Toda operación bloquea primero la VENTA (SaleService.lockDraft), nunca la solicitud sola: así
// cualquier cambio a la venta o a sus solicitudes espera al anterior y no hay bloqueos cruzados.
// La empresa de una solicitud es la de su venta.
//
// Cada paso avisa a la otra parte (canal Descuentos, ver NotificationService) dentro de la misma
// transacción: los administradores reciben la solicitud y lo que la cancele; quien la pidió recibe
// cómo se resolvió. Quien hace la acción no se avisa a sí mismo. Al resolverse una solicitud, sus
// avisos de "solicitud nueva" pasan a leídos para todos los administradores.
@Injectable()
export class DiscountRequestService {
  constructor(
    @InjectRepository(DiscountRequest)
    private readonly requestRepository: Repository<DiscountRequest>,
    @InjectRepository(DiscountRequestItem)
    private readonly requestItemRepository: Repository<DiscountRequestItem>,
    private readonly dataSource: DataSource,
    private readonly sales: SaleService,
    private readonly notifications: NotificationService,
  ) {}

  // Las más recientes primero, acotadas: `limit` (500 por defecto, 1000 máximo) con `offset`. Quien no
  // ve todo (SaleActor.canReadAny: ve todas las ventas o aprueba descuentos) solo ve las solicitudes de
  // SUS ventas (las que cobró o vendió) y las que él mismo pidió; las demás no existen para él. Cada
  // solicitud trae cargada su venta, para mostrar el número sin pedir todas las ventas.
  findAll(
    companyId: string,
    actor: SaleActor,
    filters: { status?: DiscountRequestStatus; saleId?: string; limit?: number; offset?: number } = {},
  ): Promise<DiscountRequest[]> {
    const { status, saleId } = filters;
    const limit = Math.min(Math.max(filters.limit ?? DEFAULT_REQUESTS_LIMIT, 1), MAX_REQUESTS_LIMIT);
    const narrowing = { ...(status && { status }), ...(saleId && { saleId }) };
    const where: FindOptionsWhere<DiscountRequest>[] = actor.canReadAny
      ? [{ ...narrowing, sale: { companyId } }]
      : [
          { ...narrowing, sale: { companyId, cashierId: actor.userId } },
          { ...narrowing, sale: { companyId, sellerId: actor.userId } },
          { ...narrowing, sale: { companyId }, requestedBy: actor.userId },
        ];

    return this.requestRepository.find({
      where,
      relations: { sale: true },
      order: { requestedAt: 'DESC' },
      take: limit,
      skip: Math.max(filters.offset ?? 0, 0),
    });
  }

  // Una solicitud que quien pregunta puede leer (misma regla que la lista); si no, se responde como si no
  // existiera.
  async findOne(companyId: string, actor: SaleActor, id: string): Promise<DiscountRequest> {
    const request = await this.requestRepository.findOne({
      where: { id, sale: { companyId } },
      relations: { sale: true },
    });
    if (!request) throw new NotFoundException(`Solicitud ${id} no encontrada`);
    if (request.requestedBy !== actor.userId && !canReadSale(actor, request.sale)) {
      throw new NotFoundException(`Solicitud ${id} no encontrada`);
    }
    return request;
  }

  // El número de la venta, para mostrarlo en la lista sin pedir todas las ventas: null mientras la venta
  // es un borrador (todavía no tiene número). Las listas ya traen la venta cargada; una solicitud suelta
  // (el resultado de una mutación) la busca aquí.
  async saleNumberOf(request: DiscountRequest): Promise<string | null> {
    if (request.sale) return request.sale.saleNumber;
    const sale = await this.dataSource
      .getRepository(Sale)
      .findOne({ where: { id: request.saleId }, select: { id: true, saleNumber: true } });
    return sale?.saleNumber ?? null;
  }

  // Los montos por línea de una solicitud; vacío si es sobre toda la venta.
  async findItems(companyId: string, actor: SaleActor, requestId: string): Promise<DiscountRequestItem[]> {
    await this.findOne(companyId, actor, requestId);
    return this.requestItemRepository.find({ where: { discountRequestId: requestId } });
  }

  // Pide un descuento sobre toda la venta (`requestedDiscount`) o sobre líneas (`items`, cada una
  // con su monto): uno de los dos. No cambia los totales: eso pasa solo si se aprueba. La pide el cajero
  // de la venta (quien la está armando) y desde una tienda a la que tiene acceso. Con `idempotencyKey`,
  // repetir la petición devuelve la solicitud ya creada en vez de fallar con "ya tiene una solicitud
  // activa".
  async request(
    companyId: string,
    requesterId: string,
    input: RequestDiscountInput,
    idempotencyKey?: string,
  ): Promise<DiscountRequest> {
    const itemInputs = input.items ?? [];
    const wantsItems = itemInputs.length > 0;
    const wantsWholeSale = input.requestedDiscount !== undefined && input.requestedDiscount !== null;
    if (wantsItems === wantsWholeSale) {
      throw new BadRequestException(
        'Pide el descuento de toda la venta (requestedDiscount) o el de sus líneas (items), no ambos ni ninguno',
      );
    }

    const saleItemIds = itemInputs.map((item) => item.saleItemId);
    if (new Set(saleItemIds).size !== saleItemIds.length) {
      throw new BadRequestException('Una línea no puede repetirse en la solicitud');
    }

    const wholeSaleAmount = wantsWholeSale ? new Decimal(input.requestedDiscount as string) : null;
    const itemAmounts = itemInputs.map((item) => ({
      saleItemId: item.saleItemId,
      amount: new Decimal(item.amount),
    }));
    if (
      (wholeSaleAmount && wholeSaleAmount.lessThanOrEqualTo(0)) ||
      itemAmounts.some((item) => item.amount.lessThanOrEqualTo(0))
    ) {
      throw new BadRequestException('El descuento solicitado debe ser mayor que cero');
    }
    const reason = input.reason?.trim() || null;

    return this.dataSource.transaction((manager) =>
      runIdempotent(
        manager,
        {
          companyId,
          userId: requesterId,
          operation: 'requestDiscount',
          key: idempotencyKey,
          input,
          resourceType: 'discount_request',
        },
        async () => {
          const sale = await this.sales.lockDraft(manager, companyId, input.saleId);
          if (sale.cashierId !== requesterId) {
            throw new ForbiddenException('Solo el cajero de la venta puede pedir un descuento sobre ella');
          }
          await assertStoreAccess(manager, requesterId, sale.storeId);

          const repo = manager.getRepository(DiscountRequest);
          const hasActiveRequest = await repo.existsBy({
            saleId: sale.id,
            status: In(ACTIVE_DISCOUNT_REQUEST_STATUSES),
          });
          if (hasActiveRequest) {
            throw new ConflictException('La venta ya tiene una solicitud de descuento activa');
          }

          const lines = await manager.getRepository(SaleItem).find({ where: { saleId: sale.id } });
          if (lines.length === 0) throw new BadRequestException('La venta no tiene líneas para descontar');

          if (wholeSaleAmount) {
            this.assertWithinCap(wholeSaleAmount, this.saleValue(lines), 'de la venta');
          } else {
            const linesById = new Map(lines.map((line) => [line.id, line]));
            for (const item of itemAmounts) {
              const line = linesById.get(item.saleItemId);
              if (!line) throw new BadRequestException('Alguna de las líneas indicadas no pertenece a la venta');
              this.assertWithinCap(item.amount, lineGross(line), 'de una línea');
            }
          }

          const requestedDiscount =
            wholeSaleAmount ?? itemAmounts.reduce((sum, item) => sum.plus(item.amount), new Decimal(0));
          const request = await repo.save(
            repo.create({
              saleId: sale.id,
              requestedBy: requesterId,
              requestedDiscount,
              reason,
              status: DiscountRequestStatus.PENDING,
            }),
          );

          if (itemAmounts.length > 0) {
            const itemRepo = manager.getRepository(DiscountRequestItem);
            await itemRepo.save(
              itemAmounts.map((item) =>
                itemRepo.create({
                  discountRequestId: request.id,
                  saleItemId: item.saleItemId,
                  requestedDiscount: item.amount,
                }),
              ),
            );
          }

          await this.notifyApprovers(manager, companyId, NotificationType.DISCOUNT_REQUESTED, request, sale, requesterId);
          return request;
        },
        (id) => manager.getRepository(DiscountRequest).findOneByOrFail({ id }),
      ),
    );
  }

  // Aprueba una solicitud pendiente y aplica los montos aprobados. Los que no se indiquen se
  // aprueban como se pidieron. Cualquier administrador puede aprobar, también una solicitud que él
  // mismo hizo. Con `idempotencyKey`, repetir la petición devuelve la solicitud ya aprobada en vez de
  // fallar con "ya fue resuelta".
  async approve(
    companyId: string,
    resolverId: string,
    id: string,
    input: ApproveDiscountRequestInput,
    idempotencyKey?: string,
  ): Promise<DiscountRequest> {
    return this.dataSource.transaction((manager) =>
      runIdempotent(
        manager,
        {
          companyId,
          userId: resolverId,
          operation: 'approveDiscountRequest',
          key: idempotencyKey,
          input: { id, ...input },
          resourceType: 'discount_request',
        },
        async () => {
          const { request, sale } = await this.lockRequestAndSale(manager, companyId, id);
          if (request.status !== DiscountRequestStatus.PENDING) {
            throw new ConflictException('La solicitud ya fue resuelta');
          }

          await this.applyAmounts(manager, request, sale, input, 'approve');

          request.status = DiscountRequestStatus.APPROVED;
          this.markResolved(request, resolverId, input.notes);
          // Quién la aprobó primero queda guardado aparte: editar o cancelar después no lo pisa.
          request.approvedBy = resolverId;
          request.approvedAt = request.resolvedAt;
          const saved = await manager.getRepository(DiscountRequest).save(request);

          await this.notifyRequester(manager, companyId, NotificationType.DISCOUNT_APPROVED, request, sale, resolverId);
          await this.clearPendingNotices(manager, companyId, request, resolverId);
          return saved;
        },
        (requestId) => manager.getRepository(DiscountRequest).findOneByOrFail({ id: requestId }),
      ),
    );
  }

  // Cambia los montos de un descuento YA aprobado (no las líneas a las que apunta). Lo que no se
  // indique se queda como estaba. Solo mientras la venta siga en borrador.
  async editApproved(
    companyId: string,
    editorId: string,
    id: string,
    input: ApproveDiscountRequestInput,
    idempotencyKey?: string,
  ): Promise<DiscountRequest> {
    return this.dataSource.transaction((manager) =>
      runIdempotent(
        manager,
        {
          companyId,
          userId: editorId,
          operation: 'editApprovedDiscount',
          key: idempotencyKey,
          input: { id, ...input },
          resourceType: 'discount_request',
        },
        async () => {
          const { request, sale } = await this.lockRequestAndSale(manager, companyId, id);
          if (request.status !== DiscountRequestStatus.APPROVED) {
            throw new ConflictException('Solo se puede editar un descuento aprobado');
          }

          await this.applyAmounts(manager, request, sale, input, 'edit');

          this.markResolved(request, editorId, input.notes);
          request.lastEditedBy = editorId;
          request.lastEditedAt = request.resolvedAt;
          const saved = await manager.getRepository(DiscountRequest).save(request);

          await this.notifyRequester(manager, companyId, NotificationType.DISCOUNT_EDITED, request, sale, editorId);
          return saved;
        },
        (requestId) => manager.getRepository(DiscountRequest).findOneByOrFail({ id: requestId }),
      ),
    );
  }

  // Rechaza una solicitud pendiente: la venta no cambia y queda libre para pedir otra.
  async reject(
    companyId: string,
    resolverId: string,
    id: string,
    input: DiscountRequestNotesInput,
    idempotencyKey?: string,
  ): Promise<DiscountRequest> {
    return this.dataSource.transaction((manager) =>
      runIdempotent(
        manager,
        {
          companyId,
          userId: resolverId,
          operation: 'rejectDiscountRequest',
          key: idempotencyKey,
          input: { id, ...input },
          resourceType: 'discount_request',
        },
        async () => {
          const { request, sale } = await this.lockRequestAndSale(manager, companyId, id);
          if (request.status !== DiscountRequestStatus.PENDING) {
            throw new ConflictException('La solicitud ya fue resuelta');
          }

          request.status = DiscountRequestStatus.REJECTED;
          this.markResolved(request, resolverId, input.notes);
          const saved = await manager.getRepository(DiscountRequest).save(request);

          await this.notifyRequester(
            manager,
            companyId,
            NotificationType.DISCOUNT_REJECTED,
            request,
            sale,
            resolverId,
            request.resolutionNotes,
          );
          await this.clearPendingNotices(manager, companyId, request, resolverId);
          return saved;
        },
        (requestId) => manager.getRepository(DiscountRequest).findOneByOrFail({ id: requestId }),
      ),
    );
  }

  // Cancela una solicitud activa. La puede cancelar quien la pidió o quien puede aprobar
  // (`canApprove`). Si ya estaba aprobada, el descuento se quita de la venta y de sus líneas.
  async cancel(
    companyId: string,
    userId: string,
    id: string,
    canApprove: boolean,
    input: DiscountRequestNotesInput,
  ): Promise<DiscountRequest> {
    return this.dataSource.transaction(async (manager) => {
      const { request, sale } = await this.lockRequestAndSale(manager, companyId, id);

      if (!ACTIVE_DISCOUNT_REQUEST_STATUSES.includes(request.status)) {
        throw new ConflictException('La solicitud ya no está activa');
      }
      if (request.requestedBy !== userId && !canApprove) {
        throw new ForbiddenException('Solo quien la pidió o quien aprueba descuentos puede cancelarla');
      }

      const wasPending = request.status === DiscountRequestStatus.PENDING;
      if (request.status === DiscountRequestStatus.APPROVED) {
        await this.removeAppliedDiscount(manager, request, sale);
      }

      request.status = DiscountRequestStatus.CANCELLED;
      this.markResolved(request, userId, input.notes);
      const saved = await manager.getRepository(DiscountRequest).save(request);

      // Si la cancela quien la pidió se avisa a los administradores; si la cancela un administrador,
      // a quien la pidió.
      const type = NotificationType.DISCOUNT_CANCELLED;
      if (userId === request.requestedBy) {
        await this.notifyApprovers(manager, companyId, type, request, sale, userId, request.resolutionNotes);
      } else {
        await this.notifyRequester(manager, companyId, type, request, sale, userId, request.resolutionNotes);
      }
      if (wasPending) await this.clearPendingNotices(manager, companyId, request, userId);
      return saved;
    });
  }

  // Avisa a quienes aprueban descuentos en la empresa (menos a quien hizo la acción).
  private async notifyApprovers(
    manager: EntityManager,
    companyId: string,
    type: NotificationType,
    request: DiscountRequest,
    sale: Sale,
    actorId: string,
    notes?: string | null,
  ): Promise<void> {
    const recipientIds = await this.notifications.findUserIdsWithPermission(
      manager,
      companyId,
      PermissionCode.SALES_APPROVE_DISCOUNT,
    );
    await this.notify(manager, companyId, type, request, sale, actorId, recipientIds, notes);
  }

  // Avisa a quien pidió el descuento (si no es quien hizo la acción).
  private notifyRequester(
    manager: EntityManager,
    companyId: string,
    type: NotificationType,
    request: DiscountRequest,
    sale: Sale,
    actorId: string,
    notes?: string | null,
  ): Promise<void> {
    return this.notify(manager, companyId, type, request, sale, actorId, [request.requestedBy], notes);
  }

  private async notify(
    manager: EntityManager,
    companyId: string,
    type: NotificationType,
    request: DiscountRequest,
    sale: Sale,
    actorId: string,
    recipientIds: string[],
    notes?: string | null,
  ): Promise<void> {
    await this.notifications.notify(manager, {
      companyId,
      type,
      recipientIds,
      actorId,
      entityType: NotificationEntityType.DISCOUNT_REQUEST,
      entityId: request.id,
      locationId: sale.storeId,
      reference: sale.saleNumber,
      notes,
    });
  }

  // La solicitud ya no está pendiente: el aviso de "solicitud nueva" deja de esperar respuesta, y a los
  // demás administradores se les avisa en vivo para que su lista de pendientes se ponga al día sola
  // (quien la resolvió ya se refresca con su propia operación).
  private async clearPendingNotices(
    manager: EntityManager,
    companyId: string,
    request: DiscountRequest,
    actorId: string,
  ): Promise<void> {
    await this.notifications.markEntityRead(
      manager,
      NotificationEntityType.DISCOUNT_REQUEST,
      request.id,
      [NotificationType.DISCOUNT_REQUESTED],
    );

    const approverIds = await this.notifications.findUserIdsWithPermission(
      manager,
      companyId,
      PermissionCode.SALES_APPROVE_DISCOUNT,
    );
    this.notifications.signalChange(manager, {
      companyId,
      channel: NotificationChannel.DISCOUNTS,
      entityType: NotificationEntityType.DISCOUNT_REQUEST,
      entityId: request.id,
      recipientIds: approverIds,
      exceptUserId: actorId,
    });
  }

  // Decide los montos, comprueba el tope y los aplica: en las líneas si la solicitud es sobre
  // líneas, o en el descuento general de la venta si es sobre toda la venta. Después recalcula los
  // totales; si algo falla, todo se deshace con la transacción.
  private async applyAmounts(
    manager: EntityManager,
    request: DiscountRequest,
    sale: Sale,
    input: ApproveDiscountRequestInput,
    mode: 'approve' | 'edit',
  ): Promise<void> {
    const requestItems = await manager
      .getRepository(DiscountRequestItem)
      .find({ where: { discountRequestId: request.id } });
    const lines = await manager.getRepository(SaleItem).find({ where: { saleId: sale.id } });

    const isWholeSale = requestItems.length === 0;
    const givenItems = input.items ?? [];
    const givesAmount = input.approvedDiscount !== undefined && input.approvedDiscount !== null;

    if (isWholeSale && givenItems.length > 0) {
      throw new BadRequestException(
        'Esta solicitud es sobre toda la venta: indica un solo monto (approvedDiscount), no líneas',
      );
    }
    if (!isWholeSale && givesAmount) {
      throw new BadRequestException(
        'Esta solicitud es sobre líneas: indica el monto de cada una (items), no un monto único',
      );
    }
    if (mode === 'edit' && !givesAmount && givenItems.length === 0) {
      throw new BadRequestException('Indica el nuevo monto del descuento');
    }

    if (isWholeSale) {
      const amount = givesAmount
        ? new Decimal(input.approvedDiscount as string)
        : request.requestedDiscount;
      if (amount.lessThanOrEqualTo(0)) {
        throw new BadRequestException('El descuento aprobado debe ser mayor que cero');
      }
      this.assertWithinCap(amount, this.saleValue(lines), 'de la venta');

      sale.generalDiscount = amount;
      request.approvedDiscount = amount;
    } else {
      const given = new Map<string, Decimal>();
      for (const item of givenItems) {
        if (given.has(item.saleItemId)) {
          throw new BadRequestException('Una línea no puede repetirse');
        }
        if (!requestItems.some((requestItem) => requestItem.saleItemId === item.saleItemId)) {
          throw new BadRequestException('Alguna de las líneas indicadas no pertenece a esta solicitud');
        }
        given.set(item.saleItemId, new Decimal(item.amount));
      }

      const linesById = new Map(lines.map((line) => [line.id, line]));
      const changedLines: SaleItem[] = [];
      let total = new Decimal(0);

      for (const requestItem of requestItems) {
        const line = linesById.get(requestItem.saleItemId);
        if (!line) throw new BadRequestException('Una línea de la solicitud ya no está en la venta');

        // Lo que no se indica: al aprobar se aprueba lo pedido; al editar, lo ya aprobado.
        const current =
          mode === 'edit'
            ? (requestItem.approvedDiscount ?? requestItem.requestedDiscount)
            : requestItem.requestedDiscount;
        const amount = given.get(requestItem.saleItemId) ?? current;

        const gross = lineGross(line);
        this.assertWithinCap(amount, gross, 'de una línea');

        requestItem.approvedDiscount = amount;
        line.discountAmount = amount;
        line.total = gross.minus(amount);
        changedLines.push(line);
        total = total.plus(amount);
      }
      if (total.lessThanOrEqualTo(0)) {
        throw new BadRequestException('El descuento aprobado debe ser mayor que cero');
      }

      await manager.getRepository(DiscountRequestItem).save(requestItems);
      await manager.getRepository(SaleItem).save(changedLines);
      sale.generalDiscount = new Decimal(0);
      request.approvedDiscount = total;
    }

    await this.sales.recalculate(manager, sale);
  }

  // Quita de la venta un descuento que estaba aplicado: deja las líneas sin descuento (o el
  // descuento general en cero) y recalcula. Los montos aprobados quedan en la solicitud, como
  // historial de lo que se llegó a aprobar.
  private async removeAppliedDiscount(
    manager: EntityManager,
    request: DiscountRequest,
    sale: Sale,
  ): Promise<void> {
    const requestItems = await manager
      .getRepository(DiscountRequestItem)
      .find({ where: { discountRequestId: request.id } });

    if (requestItems.length > 0) {
      const lineRepo = manager.getRepository(SaleItem);
      const lines = await lineRepo.find({
        where: { id: In(requestItems.map((requestItem) => requestItem.saleItemId)) },
      });
      for (const line of lines) {
        const gross = lineGross(line);
        line.discountAmount = new Decimal(0);
        line.total = gross;
      }
      await lineRepo.save(lines);
    }

    sale.generalDiscount = new Decimal(0);
    await this.sales.recalculate(manager, sale);
  }

  // Trae la solicitud y su venta, con la venta bloqueada y en borrador. La solicitud se lee dos
  // veces: la primera solo para saber de qué venta es, y la segunda ya con la venta bloqueada,
  // para ver su estado real. Una solicitud de otra empresa se responde como inexistente.
  private async lockRequestAndSale(
    manager: EntityManager,
    companyId: string,
    id: string,
  ): Promise<{ request: DiscountRequest; sale: Sale }> {
    const repo = manager.getRepository(DiscountRequest);

    const found = await repo.findOneBy({ id });
    const inCompany =
      found !== null && (await manager.getRepository(Sale).existsBy({ id: found.saleId, companyId }));
    if (!found || !inCompany) throw new NotFoundException(`Solicitud ${id} no encontrada`);

    const sale = await this.sales.lockDraft(manager, companyId, found.saleId);
    const request = await repo.findOneBy({ id });
    if (!request) throw new NotFoundException(`Solicitud ${id} no encontrada`);
    return { request, sale };
  }

  // Lo que vale la venta antes de descuentos: la suma de sus líneas.
  private saleValue(lines: SaleItem[]): Decimal {
    return lines.reduce((sum, line) => sum.plus(lineGross(line)), new Decimal(0));
  }

  private assertWithinCap(amount: Decimal, value: Decimal, subject: string): void {
    if (amount.greaterThan(maxDiscountFor(value))) {
      throw new BadRequestException(
        `El descuento ${subject} no puede pasar del ${MAX_DISCOUNT_PERCENT}% de su valor`,
      );
    }
  }

  private markResolved(request: DiscountRequest, userId: string, notes?: string | null): void {
    request.resolvedBy = userId;
    request.resolvedAt = new Date();
    request.resolutionNotes = notes?.trim() || null;
  }
}
