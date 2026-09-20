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
import { RecordStatus } from '../../common/enums/record-status.enum.js';
import {
  ACTIVE_DISCOUNT_REQUEST_STATUSES,
  DiscountRequestStatus,
} from '../discount-request/entities/discount-request-status.enum.js';
import { DiscountRequest } from '../discount-request/entities/discount-request.entity.js';
import { DocumentSequenceService } from '../document-sequence/document-sequence.service.js';
import { LocationType } from '../location/entities/location-type.enum.js';
import { Location } from '../location/entities/location.entity.js';
import { UserCompanyRole } from '../user-company-role/entities/user-company-role.entity.js';
import { UserLocationAccess } from '../user-location-access/entities/user-location-access.entity.js';
import { AddSaleItemInput } from './dto/add-sale-item.input.js';
import { CancelSaleInput } from './dto/cancel-sale.input.js';
import { CreateSaleInput } from './dto/create-sale.input.js';
import { UpdateSaleItemQuantityInput } from './dto/update-sale-item-quantity.input.js';
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
  ) {}

  // Las más recientes primero.
  findAll(
    companyId: string,
    filters: { status?: SaleStatus; storeId?: string } = {},
  ): Promise<Sale[]> {
    const { status, storeId } = filters;
    return this.saleRepository.find({
      where: { companyId, ...(status && { status }), ...(storeId && { storeId }) },
      order: { createdAt: 'DESC' },
    });
  }

  async findOne(companyId: string, id: string): Promise<Sale> {
    const sale = await this.saleRepository.findOneBy({ id, companyId });
    if (!sale) throw new NotFoundException(`Venta ${id} no encontrada`);
    return sale;
  }

  // En el orden en que se agregaron. La empresa se comprueba a través de la venta.
  async findItems(companyId: string, saleId: string): Promise<SaleItem[]> {
    await this.findOne(companyId, saleId);
    return this.saleItemRepository.find({ where: { saleId }, order: { createdAt: 'ASC' } });
  }

  // Crea una venta en borrador: el cajero es quien da "nueva venta". Los totales arrancan en
  // cero y cambian a medida que se agregan líneas.
  async create(companyId: string, cashierId: string, input: CreateSaleInput): Promise<Sale> {
    return this.dataSource.transaction(async (manager) => {
      const store = await manager.getRepository(Location).findOneBy({
        id: input.storeId,
        companyId,
        type: LocationType.STORE,
        status: RecordStatus.ACTIVE,
      });
      if (!store) throw new NotFoundException(`Tienda ${input.storeId} no encontrada`);

      // Solo se vende desde las tiendas a las que el usuario tiene acceso (Configuración →
      // Personal por ubicación).
      const hasAccess = await manager.getRepository(UserLocationAccess).existsBy({
        userId: cashierId,
        locationId: store.id,
        status: RecordStatus.ACTIVE,
      });
      if (!hasAccess) throw new ForbiddenException('No tienes acceso a esta tienda');

      if (input.sellerId) {
        const sellerIsMember = await manager.getRepository(UserCompanyRole).existsBy({
          userId: input.sellerId,
          companyId,
          status: RecordStatus.ACTIVE,
        });
        if (!sellerIsMember) throw new NotFoundException(`Vendedor ${input.sellerId} no encontrado`);
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
  async addItem(companyId: string, input: AddSaleItemInput): Promise<Sale> {
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
  async updateItemQuantity(companyId: string, input: UpdateSaleItemQuantityInput): Promise<Sale> {
    const quantity = new Decimal(input.quantity);
    if (quantity.lessThanOrEqualTo(0)) {
      throw new BadRequestException('La cantidad debe ser mayor que cero');
    }

    return this.dataSource.transaction(async (manager) => {
      const sale = await this.lockDraft(manager, companyId, input.saleId);
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
  async removeItem(companyId: string, saleId: string, itemId: string): Promise<Sale> {
    return this.dataSource.transaction(async (manager) => {
      const sale = await this.lockDraft(manager, companyId, saleId);
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
