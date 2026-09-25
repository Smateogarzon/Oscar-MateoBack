import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { Decimal } from 'decimal.js';
import { In } from 'typeorm';
import { RecordStatus } from '../../common/enums/record-status.enum.js';
import { IdempotencyKey } from '../idempotency/entities/idempotency-key.entity.js';
import { fingerprintOf } from '../idempotency/idempotency.js';
import { NotificationChannel } from '../notification/entities/notification-channel.enum.js';
import { NotificationEntityType } from '../notification/entities/notification-entity-type.enum.js';
import { NotificationType } from '../notification/entities/notification-type.enum.js';
import { SaleItem } from '../sale/entities/sale-item.entity.js';
import { SaleStatus } from '../sale/entities/sale-status.enum.js';
import { Sale } from '../sale/entities/sale.entity.js';
import type { SaleActor } from '../sale/sale-actor.js';
import { UserLocationAccess } from '../user-location-access/entities/user-location-access.entity.js';
import { DiscountRequestService } from './discount-request.service.js';
import { DiscountRequestItem } from './entities/discount-request-item.entity.js';
import {
  ACTIVE_DISCOUNT_REQUEST_STATUSES,
  DiscountRequestStatus,
} from './entities/discount-request-status.enum.js';
import { DiscountRequest } from './entities/discount-request.entity.js';

const COMPANY = 'company-1';
const d = (value: string) => new Decimal(value);
// Quien consulta: el cajero, que solo ve lo suyo, y quien aprueba o ve todo
const cashierActor: SaleActor = { userId: 'cashier-1', canViewAll: false, canReadAny: false };
const approverActor: SaleActor = { userId: 'admin-1', canViewAll: false, canReadAny: true };

// La venta tal como la deja SaleService.lockDraft: bloqueada y en borrador. Un borrador todavía no
// tiene número (se le asigna al cobrarla) y su cajero es 'cashier-1'.
const draftSale = (overrides: Record<string, unknown> = {}) => ({
  id: 'sale-1',
  companyId: COMPANY,
  storeId: 'store-1',
  cashierId: 'cashier-1',
  sellerId: null,
  saleNumber: null,
  status: SaleStatus.DRAFT,
  generalDiscount: d('0'),
  ...overrides,
});

// Una línea de la venta. `total` ya es lo que vale después de su descuento.
const saleLine = (id: string, total: string, discountAmount = '0') => ({
  id,
  total: d(total),
  discountAmount: d(discountAmount),
});

// El descuento de una línea dentro de una solicitud.
const requestItem = (saleItemId: string, requested: string, approved: string | null = null) => ({
  id: `ri-${saleItemId}`,
  discountRequestId: 'req-1',
  saleItemId,
  requestedDiscount: d(requested),
  approvedDiscount: approved === null ? null : d(approved),
});

const pendingRequest = (overrides: Record<string, unknown> = {}) => ({
  id: 'req-1',
  saleId: 'sale-1',
  requestedBy: 'cashier-1',
  requestedDiscount: d('10000'),
  approvedDiscount: null,
  status: DiscountRequestStatus.PENDING,
  resolvedBy: null,
  resolvedAt: null,
  resolutionNotes: null,
  approvedBy: null,
  approvedAt: null,
  lastEditedBy: null,
  lastEditedAt: null,
  ...overrides,
});

const approvedRequest = (overrides: Record<string, unknown> = {}) =>
  pendingRequest({
    status: DiscountRequestStatus.APPROVED,
    approvedDiscount: d('10000'),
    ...overrides,
  });

// Una solicitud tal como la entrega una consulta: con su venta cargada
const requestWithSale = (overrides: Record<string, unknown> = {}) =>
  pendingRequest({
    sale: { id: 'sale-1', cashierId: 'cashier-1', sellerId: null, saleNumber: null },
    ...overrides,
  });

// La venta de los ejemplos: una línea de 95000 y otra de 20000, 115000 en total. El tope del 30 %
// es 34500 sobre toda la venta, 28500 sobre la primera línea y 6000 sobre la segunda.
const twoLines = () => [saleLine('item-1', '95000'), saleLine('item-2', '20000')];

function createService() {
  const requestRepo = { find: vi.fn().mockResolvedValue([]), findOne: vi.fn() };
  const requestItemRepo = { find: vi.fn().mockResolvedValue([]) };
  // La venta que se busca fuera de una transacción (para mostrar su número)
  const saleRepo = { findOne: vi.fn() };
  const txRequestRepo = {
    existsBy: vi.fn().mockResolvedValue(false),
    findOneBy: vi.fn(),
    // La carga de un reintento con clave: el recurso tal como está ahora
    findOneByOrFail: vi.fn(async ({ id }: { id: string }) => pendingRequest({ id })),
    create: vi.fn((value: unknown) => value),
    save: vi.fn(async (value: object) => ({ id: 'req-1', ...value })),
  };
  const txRequestItemRepo = {
    find: vi.fn().mockResolvedValue([]),
    create: vi.fn((value: unknown) => value),
    save: vi.fn(async (value: unknown) => value),
  };
  const txItemRepo = {
    find: vi.fn().mockResolvedValue([]),
    save: vi.fn(async (value: unknown) => value),
  };
  // Para comprobar que la venta de la solicitud es de la empresa
  const txSaleRepo = { existsBy: vi.fn().mockResolvedValue(true) };
  // ¿Tiene acceso a la tienda? (assertStoreAccess)
  const txAccessRepo = { existsBy: vi.fn().mockResolvedValue(true) };
  // La fila de la clave de idempotencia que quedó guardada, si la hay
  const txKeyRepo = { findOneBy: vi.fn().mockResolvedValue(null) };
  const sales = {
    lockDraft: vi.fn().mockResolvedValue(draftSale()),
    recalculate: vi.fn(async (_manager: unknown, sale: object) => sale),
  };
  // Los administradores de la empresa, que son quienes reciben las solicitudes
  const notifications = {
    notify: vi.fn().mockResolvedValue(null),
    findUserIdsWithPermission: vi.fn().mockResolvedValue(['admin-1', 'admin-2']),
    markEntityRead: vi.fn().mockResolvedValue(0),
    signalChange: vi.fn(),
  };

  const repositories = new Map<unknown, unknown>([
    [DiscountRequest, txRequestRepo],
    [DiscountRequestItem, txRequestItemRepo],
    [SaleItem, txItemRepo],
    [Sale, txSaleRepo],
    [UserLocationAccess, txAccessRepo],
    [IdempotencyKey, txKeyRepo],
  ]);
  const manager = {
    // El INSERT que reclama la clave devuelve su fila (la clave era nueva); el UPDATE que guarda el
    // recurso no devuelve nada que importe
    query: vi.fn().mockResolvedValue([{ id: 'claim-1' }]),
    getRepository: (entity: unknown) => repositories.get(entity),
  };
  const dataSource = {
    transaction: vi.fn(async (fn: (manager: unknown) => unknown) => fn(manager)),
    getRepository: vi.fn(() => saleRepo),
  };

  const service = new DiscountRequestService(
    requestRepo as never,
    requestItemRepo as never,
    dataSource as never,
    sales as never,
    notifications as never,
  );
  return {
    service,
    requestRepo,
    requestItemRepo,
    saleRepo,
    txRequestRepo,
    txRequestItemRepo,
    txItemRepo,
    txSaleRepo,
    txAccessRepo,
    txKeyRepo,
    manager,
    sales,
    notifications,
    dataSource,
  };
}

// Una clave que ya se usó: el INSERT que intenta reclamarla no devuelve fila y la que quedó guardada
// apunta a `resourceId`, con la huella de `input` (o la que se diga).
function keyAlreadyUsed(
  mocks: ReturnType<typeof createService>,
  input: unknown,
  { resourceId = 'req-7' as string | null, fingerprint = fingerprintOf(input) } = {},
) {
  mocks.manager.query.mockResolvedValueOnce([]);
  mocks.txKeyRepo.findOneBy.mockResolvedValue({ fingerprint, resourceId });
}

describe('DiscountRequestService', () => {
  describe('findAll', () => {
    it('lists the requests of sales of the company, newest first, up to 500 by default', async () => {
      const { service, requestRepo } = createService();

      await service.findAll(COMPANY, approverActor);

      expect(requestRepo.find).toHaveBeenCalledWith({
        where: [{ sale: { companyId: COMPANY } }],
        relations: { sale: true },
        order: { requestedAt: 'DESC' },
        take: 500,
        skip: 0,
      });
    });

    it('can narrow the list down by status and sale', async () => {
      const { service, requestRepo } = createService();

      await service.findAll(COMPANY, approverActor, {
        status: DiscountRequestStatus.PENDING,
        saleId: 'sale-1',
      });

      expect(requestRepo.find).toHaveBeenCalledWith(
        expect.objectContaining({
          where: [
            {
              sale: { companyId: COMPANY },
              status: DiscountRequestStatus.PENDING,
              saleId: 'sale-1',
            },
          ],
        }),
      );
    });

    it('lets whoever sees all the sales see every request of the company', async () => {
      const { service, requestRepo } = createService();

      await service.findAll(COMPANY, { userId: 'viewer-1', canViewAll: true, canReadAny: true });

      expect(requestRepo.find).toHaveBeenCalledWith(
        expect.objectContaining({ where: [{ sale: { companyId: COMPANY } }] }),
      );
    });

    it('shows whoever cannot see everything only the requests of their own sales and the ones they made', async () => {
      const { service, requestRepo } = createService();

      await service.findAll(COMPANY, cashierActor);

      expect(requestRepo.find).toHaveBeenCalledWith(
        expect.objectContaining({
          where: [
            { sale: { companyId: COMPANY, cashierId: 'cashier-1' } },
            { sale: { companyId: COMPANY, sellerId: 'cashier-1' } },
            { sale: { companyId: COMPANY }, requestedBy: 'cashier-1' },
          ],
        }),
      );
    });

    it('keeps the filters in every alternative, so a filter never shows more than the asker may see', async () => {
      const { service, requestRepo } = createService();

      await service.findAll(COMPANY, cashierActor, {
        status: DiscountRequestStatus.PENDING,
        saleId: 'sale-1',
      });

      const { where } = requestRepo.find.mock.calls[0][0];
      expect(where).toHaveLength(3);
      for (const alternative of where) {
        expect(alternative).toMatchObject({ status: DiscountRequestStatus.PENDING, saleId: 'sale-1' });
        expect(alternative.sale).toMatchObject({ companyId: COMPANY });
      }
    });

    it.each([
      [undefined, 500],
      [0, 1],
      [-5, 1],
      [300, 300],
      [5000, 1000],
    ])('takes a limit of %s as %s', async (limit, take) => {
      const { service, requestRepo } = createService();

      await service.findAll(COMPANY, approverActor, { limit });

      expect(requestRepo.find.mock.calls[0][0].take).toBe(take);
    });

    it.each([
      [undefined, 0],
      [-3, 0],
      [20, 20],
    ])('takes an offset of %s as %s', async (offset, skip) => {
      const { service, requestRepo } = createService();

      await service.findAll(COMPANY, approverActor, { offset });

      expect(requestRepo.find.mock.calls[0][0].skip).toBe(skip);
    });
  });

  describe('findOne and findItems', () => {
    // Una solicitud de la venta de otro cajero, pedida por él
    const someoneElses = (overrides: Record<string, unknown> = {}) =>
      requestWithSale({
        requestedBy: 'cashier-2',
        sale: { id: 'sale-1', cashierId: 'cashier-2', sellerId: 'seller-1', saleNumber: null },
        ...overrides,
      });

    it('answers a request of another company as if it did not exist', async () => {
      const { service, requestRepo } = createService();
      requestRepo.findOne.mockResolvedValue(null);

      await expect(service.findOne(COMPANY, cashierActor, 'req-9')).rejects.toThrow(NotFoundException);
      expect(requestRepo.findOne).toHaveBeenCalledWith({
        where: { id: 'req-9', sale: { companyId: COMPANY } },
        relations: { sale: true },
      });
    });

    it('shows a request the asker made themselves', async () => {
      const { service, requestRepo } = createService();
      requestRepo.findOne.mockResolvedValue(someoneElses({ requestedBy: 'cashier-1' }));

      await expect(service.findOne(COMPANY, cashierActor, 'req-1')).resolves.toMatchObject({
        id: 'req-1',
      });
    });

    it('shows the request of a sale the asker charged', async () => {
      const { service, requestRepo } = createService();
      requestRepo.findOne.mockResolvedValue(
        someoneElses({ sale: { id: 'sale-1', cashierId: 'cashier-1', sellerId: null } }),
      );

      await expect(service.findOne(COMPANY, cashierActor, 'req-1')).resolves.toMatchObject({
        id: 'req-1',
      });
    });

    it('shows the request of a sale the asker sold', async () => {
      const { service, requestRepo } = createService();
      requestRepo.findOne.mockResolvedValue(
        someoneElses({ sale: { id: 'sale-1', cashierId: 'cashier-2', sellerId: 'cashier-1' } }),
      );

      await expect(service.findOne(COMPANY, cashierActor, 'req-1')).resolves.toMatchObject({
        id: 'req-1',
      });
    });

    it('lets whoever can read every sale, or approve, see any request', async () => {
      const { service, requestRepo } = createService();
      requestRepo.findOne.mockResolvedValue(someoneElses());

      await expect(service.findOne(COMPANY, approverActor, 'req-1')).resolves.toMatchObject({
        id: 'req-1',
      });
    });

    it('answers "not found" for the request of somebody else\'s sale, as if it did not exist', async () => {
      const { service, requestRepo } = createService();
      requestRepo.findOne.mockResolvedValue(someoneElses());

      await expect(service.findOne(COMPANY, cashierActor, 'req-1')).rejects.toThrow(NotFoundException);
    });

    it('lists the amounts per line of a request the asker can see', async () => {
      const { service, requestRepo, requestItemRepo } = createService();
      requestRepo.findOne.mockResolvedValue(requestWithSale());

      await service.findItems(COMPANY, cashierActor, 'req-1');

      expect(requestItemRepo.find).toHaveBeenCalledWith({ where: { discountRequestId: 'req-1' } });
    });

    it('does not reveal the lines of a request of another company', async () => {
      const { service, requestRepo, requestItemRepo } = createService();
      requestRepo.findOne.mockResolvedValue(null);

      await expect(service.findItems(COMPANY, cashierActor, 'req-9')).rejects.toThrow(NotFoundException);
      expect(requestItemRepo.find).not.toHaveBeenCalled();
    });

    it('does not reveal the lines of a request of somebody else\'s sale', async () => {
      const { service, requestRepo, requestItemRepo } = createService();
      requestRepo.findOne.mockResolvedValue(someoneElses());

      await expect(service.findItems(COMPANY, cashierActor, 'req-1')).rejects.toThrow(NotFoundException);
      expect(requestItemRepo.find).not.toHaveBeenCalled();
    });

    it('lets whoever can read every sale see the lines of any request', async () => {
      const { service, requestRepo, requestItemRepo } = createService();
      requestRepo.findOne.mockResolvedValue(someoneElses());

      await service.findItems(COMPANY, approverActor, 'req-1');

      expect(requestItemRepo.find).toHaveBeenCalledTimes(1);
    });
  });

  describe('saleNumberOf', () => {
    it('is null while the sale is a draft: it has no number until it is charged', async () => {
      const { service, dataSource } = createService();

      const number = await service.saleNumberOf(requestWithSale() as never);

      expect(number).toBeNull();
      expect(dataSource.getRepository).not.toHaveBeenCalled();
    });

    it('takes the number from the sale when the list already loaded it', async () => {
      const { service, dataSource } = createService();

      const number = await service.saleNumberOf(
        requestWithSale({ sale: { id: 'sale-1', saleNumber: 'VTA-000125' } }) as never,
      );

      expect(number).toBe('VTA-000125');
      expect(dataSource.getRepository).not.toHaveBeenCalled();
    });

    it('looks the sale up when the request comes on its own (the result of a mutation)', async () => {
      const { service, saleRepo } = createService();
      saleRepo.findOne.mockResolvedValue({ id: 'sale-1', saleNumber: 'VTA-000125' });

      const number = await service.saleNumberOf(pendingRequest() as never);

      expect(number).toBe('VTA-000125');
      expect(saleRepo.findOne).toHaveBeenCalledWith({
        where: { id: 'sale-1' },
        select: { id: true, saleNumber: true },
      });
    });

    it('is null when the sale looked up has no number or cannot be found', async () => {
      const { service, saleRepo } = createService();
      saleRepo.findOne.mockResolvedValueOnce({ id: 'sale-1', saleNumber: null });
      saleRepo.findOne.mockResolvedValueOnce(null);

      await expect(service.saleNumberOf(pendingRequest() as never)).resolves.toBeNull();
      await expect(service.saleNumberOf(pendingRequest() as never)).resolves.toBeNull();
    });
  });

  describe('request', () => {
    it('asks for a discount on the whole sale with a single amount', async () => {
      const { service, txItemRepo, txRequestRepo, txRequestItemRepo } = createService();
      txItemRepo.find.mockResolvedValue(twoLines());

      const request = await service.request(COMPANY, 'cashier-1', {
        saleId: 'sale-1',
        requestedDiscount: '10000',
        reason: '  Cliente frecuente ',
      });

      const created = txRequestRepo.create.mock.calls[0][0];
      expect(created).toMatchObject({
        saleId: 'sale-1',
        requestedBy: 'cashier-1',
        reason: 'Cliente frecuente',
        status: DiscountRequestStatus.PENDING,
      });
      expect(created.requestedDiscount.toFixed(2)).toBe('10000.00');
      // Una solicitud sobre toda la venta no lleva filas por línea.
      expect(txRequestItemRepo.save).not.toHaveBeenCalled();
      expect(request.id).toBe('req-1');
    });

    it('lets the whole-sale amount be up to 30 percent of the sale, and not a cent more', async () => {
      const { service, txItemRepo } = createService();
      txItemRepo.find.mockResolvedValue(twoLines());

      await expect(
        service.request(COMPANY, 'cashier-1', { saleId: 'sale-1', requestedDiscount: '34500' }),
      ).resolves.toMatchObject({ id: 'req-1' });
      await expect(
        service.request(COMPANY, 'cashier-1', { saleId: 'sale-1', requestedDiscount: '34500.01' }),
      ).rejects.toThrow(BadRequestException);
    });

    it('asks for a different discount on each line, and the request is worth their sum', async () => {
      const { service, txItemRepo, txRequestRepo, txRequestItemRepo } = createService();
      txItemRepo.find.mockResolvedValue(twoLines());

      // 10 % de 95000 en la primera línea y 5 % de 20000 en la segunda
      await service.request(COMPANY, 'cashier-1', {
        saleId: 'sale-1',
        items: [
          { saleItemId: 'item-1', amount: '9500' },
          { saleItemId: 'item-2', amount: '1000' },
        ],
      });

      expect(txRequestRepo.create.mock.calls[0][0].requestedDiscount.toFixed(2)).toBe('10500.00');
      expect(txRequestItemRepo.create).toHaveBeenCalledTimes(2);
      const first = txRequestItemRepo.create.mock.calls[0][0];
      expect(first).toMatchObject({ discountRequestId: 'req-1', saleItemId: 'item-1' });
      expect(first.requestedDiscount.toFixed(2)).toBe('9500.00');
      const second = txRequestItemRepo.create.mock.calls[1][0];
      expect(second).toMatchObject({ discountRequestId: 'req-1', saleItemId: 'item-2' });
      expect(second.requestedDiscount.toFixed(2)).toBe('1000.00');
      expect(txRequestItemRepo.save).toHaveBeenCalledTimes(1);
    });

    it('limits each line to 30 percent of its own value', async () => {
      const { service, txItemRepo, txRequestRepo } = createService();
      txItemRepo.find.mockResolvedValue(twoLines());

      // La segunda línea vale 20000: su tope es 6000, aunque la primera admitiría más.
      await expect(
        service.request(COMPANY, 'cashier-1', {
          saleId: 'sale-1',
          items: [{ saleItemId: 'item-2', amount: '6000' }],
        }),
      ).resolves.toMatchObject({ id: 'req-1' });
      await expect(
        service.request(COMPANY, 'cashier-1', {
          saleId: 'sale-1',
          items: [
            { saleItemId: 'item-1', amount: '9500' },
            { saleItemId: 'item-2', amount: '6000.01' },
          ],
        }),
      ).rejects.toThrow(BadRequestException);
      expect(txRequestRepo.save).toHaveBeenCalledTimes(1);
    });

    it('counts a line at its value before the discount it already carries', async () => {
      const { service, txItemRepo } = createService();
      // Una línea de 100000 con 5000 de descuento propio: su total es 95000 pero vale 100000.
      txItemRepo.find.mockResolvedValue([saleLine('item-1', '95000', '5000')]);

      await expect(
        service.request(COMPANY, 'cashier-1', {
          saleId: 'sale-1',
          items: [{ saleItemId: 'item-1', amount: '30000' }],
        }),
      ).resolves.toMatchObject({ id: 'req-1' });
      await expect(
        service.request(COMPANY, 'cashier-1', {
          saleId: 'sale-1',
          items: [{ saleItemId: 'item-1', amount: '30000.01' }],
        }),
      ).rejects.toThrow(BadRequestException);
    });

    it('asks for either the whole sale or its lines, not both and not neither, before touching the database', async () => {
      const { service, dataSource } = createService();

      await expect(
        service.request(COMPANY, 'cashier-1', {
          saleId: 'sale-1',
          requestedDiscount: '1000',
          items: [{ saleItemId: 'item-1', amount: '500' }],
        }),
      ).rejects.toThrow(BadRequestException);
      await expect(service.request(COMPANY, 'cashier-1', { saleId: 'sale-1' })).rejects.toThrow(
        BadRequestException,
      );
      expect(dataSource.transaction).not.toHaveBeenCalled();
    });

    it('does not accept the same line twice', async () => {
      const { service, dataSource } = createService();

      await expect(
        service.request(COMPANY, 'cashier-1', {
          saleId: 'sale-1',
          items: [
            { saleItemId: 'item-1', amount: '500' },
            { saleItemId: 'item-1', amount: '600' },
          ],
        }),
      ).rejects.toThrow(BadRequestException);
      expect(dataSource.transaction).not.toHaveBeenCalled();
    });

    it('does not accept a line that is not in the sale', async () => {
      const { service, txItemRepo, txRequestRepo } = createService();
      txItemRepo.find.mockResolvedValue(twoLines());

      await expect(
        service.request(COMPANY, 'cashier-1', {
          saleId: 'sale-1',
          items: [{ saleItemId: 'item-9', amount: '500' }],
        }),
      ).rejects.toThrow(BadRequestException);
      expect(txRequestRepo.save).not.toHaveBeenCalled();
    });

    it('rejects an amount of zero, on the whole sale or on a line, before touching the database', async () => {
      const { service, dataSource } = createService();

      await expect(
        service.request(COMPANY, 'cashier-1', { saleId: 'sale-1', requestedDiscount: '0.00' }),
      ).rejects.toThrow(BadRequestException);
      await expect(
        service.request(COMPANY, 'cashier-1', {
          saleId: 'sale-1',
          items: [{ saleItemId: 'item-1', amount: '0' }],
        }),
      ).rejects.toThrow(BadRequestException);
      expect(dataSource.transaction).not.toHaveBeenCalled();
    });

    it('allows only one active request per sale', async () => {
      const { service, txItemRepo, txRequestRepo } = createService();
      txItemRepo.find.mockResolvedValue(twoLines());
      txRequestRepo.existsBy.mockResolvedValue(true);

      await expect(
        service.request(COMPANY, 'cashier-1', { saleId: 'sale-1', requestedDiscount: '1000' }),
      ).rejects.toThrow(ConflictException);
      expect(txRequestRepo.existsBy).toHaveBeenCalledWith({
        saleId: 'sale-1',
        status: In(ACTIVE_DISCOUNT_REQUEST_STATUSES),
      });
      expect(txRequestRepo.save).not.toHaveBeenCalled();
    });

    it('does not let a discount be asked for on a sale without lines', async () => {
      const { service, txRequestRepo } = createService();

      await expect(
        service.request(COMPANY, 'cashier-1', { saleId: 'sale-1', requestedDiscount: '1000' }),
      ).rejects.toThrow(BadRequestException);
      expect(txRequestRepo.save).not.toHaveBeenCalled();
    });

    it('only works on a draft sale of the company, locked while it runs', async () => {
      const { service, sales, txRequestRepo } = createService();
      sales.lockDraft.mockRejectedValue(
        new ConflictException('Solo se puede modificar una venta en borrador'),
      );

      await expect(
        service.request(COMPANY, 'cashier-1', { saleId: 'sale-1', requestedDiscount: '1000' }),
      ).rejects.toThrow(ConflictException);
      expect(sales.lockDraft).toHaveBeenCalledWith(expect.anything(), COMPANY, 'sale-1');
      expect(txRequestRepo.save).not.toHaveBeenCalled();
    });

    describe('who can ask for it, and from where', () => {
      it('only lets the cashier of the sale ask for a discount on it', async () => {
        const { service, sales, txItemRepo, txRequestRepo, txAccessRepo, notifications } = createService();
        sales.lockDraft.mockResolvedValue(draftSale({ cashierId: 'cashier-2' }));
        txItemRepo.find.mockResolvedValue(twoLines());

        await expect(
          service.request(COMPANY, 'cashier-1', { saleId: 'sale-1', requestedDiscount: '1000' }),
        ).rejects.toThrow('Solo el cajero de la venta puede pedir un descuento sobre ella');

        expect(txAccessRepo.existsBy).not.toHaveBeenCalled();
        expect(txRequestRepo.save).not.toHaveBeenCalled();
        expect(notifications.notify).not.toHaveBeenCalled();
      });

      it('does not let the seller ask for it when somebody else is the cashier of the sale', async () => {
        const { service, sales, txItemRepo, txRequestRepo } = createService();
        sales.lockDraft.mockResolvedValue(draftSale({ cashierId: 'cashier-2', sellerId: 'cashier-1' }));
        txItemRepo.find.mockResolvedValue(twoLines());

        await expect(
          service.request(COMPANY, 'cashier-1', { saleId: 'sale-1', requestedDiscount: '1000' }),
        ).rejects.toThrow(ForbiddenException);
        expect(txRequestRepo.save).not.toHaveBeenCalled();
      });

      it('does not even let an administrator ask for it on the sale of a cashier', async () => {
        const { service, txItemRepo, txRequestRepo } = createService();
        txItemRepo.find.mockResolvedValue(twoLines());

        await expect(
          service.request(COMPANY, 'admin-1', { saleId: 'sale-1', requestedDiscount: '1000' }),
        ).rejects.toThrow(ForbiddenException);
        expect(txRequestRepo.save).not.toHaveBeenCalled();
      });

      it('needs access to the store of the sale', async () => {
        const { service, txItemRepo, txRequestRepo, txAccessRepo, notifications } = createService();
        txItemRepo.find.mockResolvedValue(twoLines());
        txAccessRepo.existsBy.mockResolvedValue(false);

        await expect(
          service.request(COMPANY, 'cashier-1', { saleId: 'sale-1', requestedDiscount: '1000' }),
        ).rejects.toThrow('No tienes acceso a esta tienda');

        expect(txAccessRepo.existsBy).toHaveBeenCalledWith({
          userId: 'cashier-1',
          locationId: 'store-1',
          status: RecordStatus.ACTIVE,
        });
        expect(txRequestRepo.save).not.toHaveBeenCalled();
        expect(notifications.notify).not.toHaveBeenCalled();
      });

      it('locks the sale before it checks anything or creates the request', async () => {
        const { service, sales, txItemRepo, txRequestRepo } = createService();
        txItemRepo.find.mockResolvedValue(twoLines());

        await service.request(COMPANY, 'cashier-1', { saleId: 'sale-1', requestedDiscount: '1000' });

        expect(sales.lockDraft.mock.invocationCallOrder[0]).toBeLessThan(
          txRequestRepo.save.mock.invocationCallOrder[0],
        );
      });
    });

    describe('with an idempotency key', () => {
      const input = { saleId: 'sale-1', requestedDiscount: '10000' };

      it('claims the key in the same transaction as the request and records what was created', async () => {
        const { service, manager, dataSource, txItemRepo, txRequestRepo } = createService();
        txItemRepo.find.mockResolvedValue(twoLines());

        const request = await service.request(COMPANY, 'cashier-1', input, 'key-1');

        expect(dataSource.transaction).toHaveBeenCalledTimes(1);
        expect(manager.query).toHaveBeenNthCalledWith(
          1,
          expect.stringContaining('INSERT INTO "idempotency_keys"'),
          [COMPANY, 'cashier-1', 'requestDiscount', 'key-1', fingerprintOf(input)],
        );
        expect(manager.query).toHaveBeenNthCalledWith(
          2,
          expect.stringContaining('UPDATE "idempotency_keys"'),
          ['claim-1', 'discount_request', request.id],
        );
        // La clave se reclama antes de hacer nada
        expect(manager.query.mock.invocationCallOrder[0]).toBeLessThan(
          txRequestRepo.save.mock.invocationCallOrder[0],
        );
      });

      it('does not claim anything when the request comes without a key', async () => {
        const { service, manager, txKeyRepo, txItemRepo } = createService();
        txItemRepo.find.mockResolvedValue(twoLines());

        await service.request(COMPANY, 'cashier-1', input);

        expect(manager.query).not.toHaveBeenCalled();
        expect(txKeyRepo.findOneBy).not.toHaveBeenCalled();
      });

      it('gives back the request that was already made when the same key comes again, instead of failing with "already has an active request"', async () => {
        const mocks = createService();
        const { service, manager, txKeyRepo, txRequestRepo, txRequestItemRepo, sales, notifications } = mocks;
        keyAlreadyUsed(mocks, input);
        // Sin la clave, el reintento fallaría por cualquiera de las dos
        txRequestRepo.existsBy.mockResolvedValue(true);
        sales.lockDraft.mockRejectedValue(new ConflictException('Solo se puede modificar una venta en borrador'));

        const again = await service.request(COMPANY, 'cashier-1', input, 'key-1');

        expect(again.id).toBe('req-7');
        expect(txKeyRepo.findOneBy).toHaveBeenCalledWith({
          companyId: COMPANY,
          userId: 'cashier-1',
          operation: 'requestDiscount',
          key: 'key-1',
        });
        expect(txRequestRepo.findOneByOrFail).toHaveBeenCalledWith({ id: 'req-7' });
        // Solo el intento de reclamar: no hay nada que crear en el reintento
        expect(manager.query).toHaveBeenCalledTimes(1);
        expect(sales.lockDraft).not.toHaveBeenCalled();
        expect(txRequestRepo.save).not.toHaveBeenCalled();
        expect(txRequestItemRepo.save).not.toHaveBeenCalled();
        expect(notifications.notify).not.toHaveBeenCalled();
      });

      it('refuses the same key with other data, and creates nothing', async () => {
        const mocks = createService();
        const { service, txRequestRepo, sales } = mocks;
        keyAlreadyUsed(mocks, input);

        await expect(
          service.request(COMPANY, 'cashier-1', { ...input, requestedDiscount: '20000' }, 'key-1'),
        ).rejects.toThrow(ConflictException);

        expect(txRequestRepo.findOneByOrFail).not.toHaveBeenCalled();
        expect(txRequestRepo.save).not.toHaveBeenCalled();
        expect(sales.lockDraft).not.toHaveBeenCalled();
      });

      it('says the operation is still going on when the key was claimed but has no result yet', async () => {
        const mocks = createService();
        const { service, txRequestRepo } = mocks;
        keyAlreadyUsed(mocks, input, { resourceId: null });

        await expect(service.request(COMPANY, 'cashier-1', input, 'key-1')).rejects.toThrow(
          'Esta operación ya está en curso',
        );
        expect(txRequestRepo.save).not.toHaveBeenCalled();
      });
    });
  });

  describe('approve a request on the whole sale', () => {
    it('approves what was asked for by default and applies it as the discount of the sale', async () => {
      const { service, txRequestRepo, txItemRepo, sales } = createService();
      const sale = draftSale();
      sales.lockDraft.mockResolvedValue(sale);
      txItemRepo.find.mockResolvedValue(twoLines());
      txRequestRepo.findOneBy.mockResolvedValue(pendingRequest());

      const request = await service.approve(COMPANY, 'admin-1', 'req-1', { notes: '  Ok ' });

      expect(sale.generalDiscount.toFixed(2)).toBe('10000.00');
      expect(sales.recalculate).toHaveBeenCalledWith(expect.anything(), sale);
      expect(request.status).toBe(DiscountRequestStatus.APPROVED);
      expect(request.approvedDiscount?.toFixed(2)).toBe('10000.00');
      expect(request.resolvedBy).toBe('admin-1');
      expect(request.resolvedAt).toBeInstanceOf(Date);
      expect(request.resolutionNotes).toBe('Ok');
    });

    it('lets the administrator approve more than the cashier asked for, up to the cap', async () => {
      const { service, txRequestRepo, txItemRepo, sales } = createService();
      const sale = draftSale();
      sales.lockDraft.mockResolvedValue(sale);
      txItemRepo.find.mockResolvedValue(twoLines());
      txRequestRepo.findOneBy.mockResolvedValue(pendingRequest());

      const request = await service.approve(COMPANY, 'admin-1', 'req-1', {
        approvedDiscount: '34500',
      });

      expect(sale.generalDiscount.toFixed(2)).toBe('34500.00');
      expect(request.approvedDiscount?.toFixed(2)).toBe('34500.00');
    });

    it('does not approve past the cap, nor an amount of zero', async () => {
      const { service, txRequestRepo, txItemRepo, sales } = createService();
      txItemRepo.find.mockResolvedValue(twoLines());
      txRequestRepo.findOneBy.mockResolvedValue(pendingRequest());

      await expect(
        service.approve(COMPANY, 'admin-1', 'req-1', { approvedDiscount: '34500.01' }),
      ).rejects.toThrow(BadRequestException);
      await expect(
        service.approve(COMPANY, 'admin-1', 'req-1', { approvedDiscount: '0' }),
      ).rejects.toThrow(BadRequestException);
      expect(sales.recalculate).not.toHaveBeenCalled();
      expect(txRequestRepo.save).not.toHaveBeenCalled();
    });

    it('does not take amounts per line for a request on the whole sale', async () => {
      const { service, txRequestRepo, txItemRepo } = createService();
      txItemRepo.find.mockResolvedValue(twoLines());
      txRequestRepo.findOneBy.mockResolvedValue(pendingRequest());

      await expect(
        service.approve(COMPANY, 'admin-1', 'req-1', {
          items: [{ saleItemId: 'item-1', amount: '100' }],
        }),
      ).rejects.toThrow(BadRequestException);
    });
  });

  describe('approve a request on lines', () => {
    // Una solicitud pendiente sobre las dos líneas: 10 % de 95000 y 5 % de 20000.
    function withLineRequest() {
      const mocks = createService();
      const lines = twoLines();
      const items = [requestItem('item-1', '9500'), requestItem('item-2', '1000')];
      const sale = draftSale();
      mocks.sales.lockDraft.mockResolvedValue(sale);
      mocks.txItemRepo.find.mockResolvedValue(lines);
      mocks.txRequestItemRepo.find.mockResolvedValue(items);
      mocks.txRequestRepo.findOneBy.mockResolvedValue(pendingRequest({ requestedDiscount: d('10500') }));
      return { ...mocks, lines, items, sale };
    }

    it('writes each approved amount into its own line, and none into the sale-wide discount', async () => {
      const { service, lines, items, sale, sales, txItemRepo, txRequestItemRepo } = withLineRequest();

      const request = await service.approve(COMPANY, 'admin-1', 'req-1', {});

      expect(lines[0].discountAmount.toFixed(2)).toBe('9500.00');
      expect(lines[0].total.toFixed(2)).toBe('85500.00');
      expect(lines[1].discountAmount.toFixed(2)).toBe('1000.00');
      expect(lines[1].total.toFixed(2)).toBe('19000.00');
      expect(items[0].approvedDiscount?.toFixed(2)).toBe('9500.00');
      expect(items[1].approvedDiscount?.toFixed(2)).toBe('1000.00');
      expect(sale.generalDiscount.toFixed(2)).toBe('0.00');
      expect(request.approvedDiscount?.toFixed(2)).toBe('10500.00');
      expect(request.status).toBe(DiscountRequestStatus.APPROVED);
      expect(txItemRepo.save).toHaveBeenCalledTimes(1);
      expect(txRequestItemRepo.save).toHaveBeenCalledTimes(1);
      expect(sales.recalculate).toHaveBeenCalledWith(expect.anything(), sale);
    });

    it('can approve a different amount for some lines and keeps what was asked for in the rest', async () => {
      const { service, lines } = withLineRequest();

      const request = await service.approve(COMPANY, 'admin-1', 'req-1', {
        items: [{ saleItemId: 'item-1', amount: '5000' }],
      });

      expect(lines[0].discountAmount.toFixed(2)).toBe('5000.00');
      expect(lines[1].discountAmount.toFixed(2)).toBe('1000.00');
      expect(request.approvedDiscount?.toFixed(2)).toBe('6000.00');
    });

    it('can approve more than was asked for on a line, up to 30 percent of its value', async () => {
      const { service, lines } = withLineRequest();

      await service.approve(COMPANY, 'admin-1', 'req-1', {
        items: [
          { saleItemId: 'item-1', amount: '28500' },
          { saleItemId: 'item-2', amount: '6000' },
        ],
      });

      expect(lines[0].total.toFixed(2)).toBe('66500.00');
      expect(lines[1].total.toFixed(2)).toBe('14000.00');
    });

    it('limits each line to 30 percent of its own value, and saves nothing if one goes over', async () => {
      const { service, txItemRepo, txRequestItemRepo, txRequestRepo } = withLineRequest();

      await expect(
        service.approve(COMPANY, 'admin-1', 'req-1', {
          items: [{ saleItemId: 'item-2', amount: '6000.01' }],
        }),
      ).rejects.toThrow(BadRequestException);
      expect(txItemRepo.save).not.toHaveBeenCalled();
      expect(txRequestItemRepo.save).not.toHaveBeenCalled();
      expect(txRequestRepo.save).not.toHaveBeenCalled();
    });

    it('does not take a line that is not part of the request', async () => {
      const { service } = withLineRequest();

      await expect(
        service.approve(COMPANY, 'admin-1', 'req-1', {
          items: [{ saleItemId: 'item-9', amount: '100' }],
        }),
      ).rejects.toThrow(BadRequestException);
    });

    it('does not take a single amount for a request on lines', async () => {
      const { service } = withLineRequest();

      await expect(
        service.approve(COMPANY, 'admin-1', 'req-1', { approvedDiscount: '1000' }),
      ).rejects.toThrow(BadRequestException);
    });

    it('does not approve when every line is left without discount', async () => {
      const { service, txRequestRepo } = withLineRequest();

      await expect(
        service.approve(COMPANY, 'admin-1', 'req-1', {
          items: [
            { saleItemId: 'item-1', amount: '0' },
            { saleItemId: 'item-2', amount: '0' },
          ],
        }),
      ).rejects.toThrow(BadRequestException);
      expect(txRequestRepo.save).not.toHaveBeenCalled();
    });
  });

  describe('approve, in any kind of request', () => {
    it('lets an administrator approve a request they made themselves', async () => {
      const { service, txRequestRepo, txItemRepo } = createService();
      txItemRepo.find.mockResolvedValue(twoLines());
      txRequestRepo.findOneBy.mockResolvedValue(pendingRequest({ requestedBy: 'admin-1' }));

      const request = await service.approve(COMPANY, 'admin-1', 'req-1', {});

      expect(request.status).toBe(DiscountRequestStatus.APPROVED);
    });

    it.each([
      DiscountRequestStatus.APPROVED,
      DiscountRequestStatus.REJECTED,
      DiscountRequestStatus.CANCELLED,
    ])('cannot approve a request that is already %s', async (status) => {
      const { service, txRequestRepo, sales } = createService();
      txRequestRepo.findOneBy.mockResolvedValue(pendingRequest({ status }));

      await expect(service.approve(COMPANY, 'admin-1', 'req-1', {})).rejects.toThrow(
        ConflictException,
      );
      expect(sales.recalculate).not.toHaveBeenCalled();
    });

    it('does not save the approval when the totals of the sale no longer add up', async () => {
      const { service, txRequestRepo, txItemRepo, sales } = createService();
      txItemRepo.find.mockResolvedValue(twoLines());
      txRequestRepo.findOneBy.mockResolvedValue(pendingRequest());
      sales.recalculate.mockRejectedValue(
        new BadRequestException('El descuento de la venta supera el total de sus líneas'),
      );

      await expect(service.approve(COMPANY, 'admin-1', 'req-1', {})).rejects.toThrow(
        BadRequestException,
      );
      expect(txRequestRepo.save).not.toHaveBeenCalled();
    });

    it('answers a request of another company as if it did not exist, without locking anything', async () => {
      const { service, txRequestRepo, txSaleRepo, sales } = createService();
      txRequestRepo.findOneBy.mockResolvedValue(pendingRequest());
      txSaleRepo.existsBy.mockResolvedValue(false);

      await expect(service.approve(COMPANY, 'admin-1', 'req-1', {})).rejects.toThrow(
        NotFoundException,
      );
      expect(txSaleRepo.existsBy).toHaveBeenCalledWith({ id: 'sale-1', companyId: COMPANY });
      expect(sales.lockDraft).not.toHaveBeenCalled();
    });

    it('fails when the request does not exist', async () => {
      const { service, txRequestRepo } = createService();
      txRequestRepo.findOneBy.mockResolvedValue(null);

      await expect(service.approve(COMPANY, 'admin-9', 'req-9', {})).rejects.toThrow(
        NotFoundException,
      );
    });

    it('locks the sale before reading the request again, so its state is the real one', async () => {
      const { service, txRequestRepo, txItemRepo, sales } = createService();
      txItemRepo.find.mockResolvedValue(twoLines());
      txRequestRepo.findOneBy.mockResolvedValue(pendingRequest());

      await service.approve(COMPANY, 'admin-1', 'req-1', {});

      expect(sales.lockDraft).toHaveBeenCalledWith(expect.anything(), COMPANY, 'sale-1');
      expect(txRequestRepo.findOneBy).toHaveBeenCalledTimes(2);
    });

    it('leaves who approved it and when, apart from who resolved it last', async () => {
      const { service, txRequestRepo, txItemRepo } = createService();
      txItemRepo.find.mockResolvedValue(twoLines());
      txRequestRepo.findOneBy.mockResolvedValue(pendingRequest());

      const request = await service.approve(COMPANY, 'admin-1', 'req-1', {});

      expect(request.approvedBy).toBe('admin-1');
      expect(request.approvedAt).toBeInstanceOf(Date);
      expect(request.approvedAt).toBe(request.resolvedAt);
      // Nadie la ha editado todavía
      expect(request.lastEditedBy).toBeNull();
      expect(request.lastEditedAt).toBeNull();
    });
  });

  describe('editApproved', () => {
    it('changes the amount of an approved request on the whole sale', async () => {
      const { service, txRequestRepo, txItemRepo, sales } = createService();
      const sale = draftSale({ generalDiscount: d('10000') });
      sales.lockDraft.mockResolvedValue(sale);
      txItemRepo.find.mockResolvedValue(twoLines());
      txRequestRepo.findOneBy.mockResolvedValue(approvedRequest());

      const request = await service.editApproved(COMPANY, 'admin-2', 'req-1', {
        approvedDiscount: '15000',
        notes: ' El cliente compró más ',
      });

      expect(sale.generalDiscount.toFixed(2)).toBe('15000.00');
      expect(sales.recalculate).toHaveBeenCalledWith(expect.anything(), sale);
      expect(request.status).toBe(DiscountRequestStatus.APPROVED);
      expect(request.approvedDiscount?.toFixed(2)).toBe('15000.00');
      expect(request.resolvedBy).toBe('admin-2');
      expect(request.resolutionNotes).toBe('El cliente compró más');
    });

    it('changes the amount of one line of an approved request and leaves the others as they were', async () => {
      const { service, txRequestRepo, txRequestItemRepo, txItemRepo, sales } = createService();
      // Ya aprobada: 9500 en la primera línea (que vale 95000) y 1000 en la segunda (que vale 20000).
      const lines = [saleLine('item-1', '85500', '9500'), saleLine('item-2', '19000', '1000')];
      const items = [requestItem('item-1', '9500', '9500'), requestItem('item-2', '1000', '1000')];
      sales.lockDraft.mockResolvedValue(draftSale());
      txItemRepo.find.mockResolvedValue(lines);
      txRequestItemRepo.find.mockResolvedValue(items);
      txRequestRepo.findOneBy.mockResolvedValue(approvedRequest({ approvedDiscount: d('10500') }));

      const request = await service.editApproved(COMPANY, 'admin-2', 'req-1', {
        items: [{ saleItemId: 'item-1', amount: '5000' }],
      });

      expect(lines[0].discountAmount.toFixed(2)).toBe('5000.00');
      expect(lines[0].total.toFixed(2)).toBe('90000.00');
      expect(lines[1].discountAmount.toFixed(2)).toBe('1000.00');
      expect(lines[1].total.toFixed(2)).toBe('19000.00');
      expect(items[0].approvedDiscount?.toFixed(2)).toBe('5000.00');
      expect(request.approvedDiscount?.toFixed(2)).toBe('6000.00');
      expect(sales.recalculate).toHaveBeenCalled();
    });

    it('leaves who changed it last and when, and keeps who approved it first', async () => {
      const { service, txRequestRepo, txItemRepo } = createService();
      const approvedAt = new Date('2026-09-24T10:00:00Z');
      txItemRepo.find.mockResolvedValue(twoLines());
      txRequestRepo.findOneBy.mockResolvedValue(approvedRequest({ approvedBy: 'admin-1', approvedAt }));

      const request = await service.editApproved(COMPANY, 'admin-2', 'req-1', {
        approvedDiscount: '15000',
      });

      expect(request.lastEditedBy).toBe('admin-2');
      expect(request.lastEditedAt).toBeInstanceOf(Date);
      expect(request.lastEditedAt).toBe(request.resolvedAt);
      // Editar no pisa la aprobación original
      expect(request.approvedBy).toBe('admin-1');
      expect(request.approvedAt).toBe(approvedAt);
    });

    it('keeps the 30 percent cap for the administrator too', async () => {
      const { service, txRequestRepo, txItemRepo, sales } = createService();
      txItemRepo.find.mockResolvedValue(twoLines());
      txRequestRepo.findOneBy.mockResolvedValue(approvedRequest());

      await expect(
        service.editApproved(COMPANY, 'admin-2', 'req-1', { approvedDiscount: '34500.01' }),
      ).rejects.toThrow(BadRequestException);
      expect(sales.recalculate).not.toHaveBeenCalled();
    });

    it('needs a new amount to change', async () => {
      const { service, txRequestRepo } = createService();
      txRequestRepo.findOneBy.mockResolvedValue(approvedRequest());

      await expect(service.editApproved(COMPANY, 'admin-2', 'req-1', {})).rejects.toThrow(
        BadRequestException,
      );
      expect(txRequestRepo.save).not.toHaveBeenCalled();
    });

    it('cannot change which lines the discount points at', async () => {
      const { service, txRequestRepo, txRequestItemRepo, txItemRepo } = createService();
      txItemRepo.find.mockResolvedValue(twoLines());
      txRequestItemRepo.find.mockResolvedValue([requestItem('item-1', '9500', '9500')]);
      txRequestRepo.findOneBy.mockResolvedValue(approvedRequest());

      await expect(
        service.editApproved(COMPANY, 'admin-2', 'req-1', {
          items: [{ saleItemId: 'item-2', amount: '100' }],
        }),
      ).rejects.toThrow(BadRequestException);
    });

    it.each([
      DiscountRequestStatus.PENDING,
      DiscountRequestStatus.REJECTED,
      DiscountRequestStatus.CANCELLED,
    ])('only edits an approved discount, not one that is %s', async (status) => {
      const { service, txRequestRepo, sales } = createService();
      txRequestRepo.findOneBy.mockResolvedValue(pendingRequest({ status }));

      await expect(
        service.editApproved(COMPANY, 'admin-2', 'req-1', { approvedDiscount: '100' }),
      ).rejects.toThrow(ConflictException);
      expect(sales.recalculate).not.toHaveBeenCalled();
    });

    it('only works while the sale is still a draft', async () => {
      const { service, txRequestRepo, sales } = createService();
      txRequestRepo.findOneBy.mockResolvedValue(approvedRequest());
      sales.lockDraft.mockRejectedValue(
        new ConflictException('Solo se puede modificar una venta en borrador'),
      );

      await expect(
        service.editApproved(COMPANY, 'admin-2', 'req-1', { approvedDiscount: '100' }),
      ).rejects.toThrow(ConflictException);
      expect(txRequestRepo.save).not.toHaveBeenCalled();
    });
  });

  describe('reject', () => {
    it('rejects a pending request and leaves the sale as it was', async () => {
      const { service, txRequestRepo, sales } = createService();
      txRequestRepo.findOneBy.mockResolvedValue(pendingRequest());

      const request = await service.reject(COMPANY, 'admin-1', 'req-1', { notes: ' Muy alto ' });

      expect(request.status).toBe(DiscountRequestStatus.REJECTED);
      expect(request.approvedDiscount).toBeNull();
      expect(request.resolvedBy).toBe('admin-1');
      expect(request.resolutionNotes).toBe('Muy alto');
      expect(sales.recalculate).not.toHaveBeenCalled();
    });

    it('does not count as an approval: nobody is left as the one who approved it', async () => {
      const { service, txRequestRepo } = createService();
      txRequestRepo.findOneBy.mockResolvedValue(pendingRequest());

      const request = await service.reject(COMPANY, 'admin-1', 'req-1', {});

      expect(request.approvedBy).toBeNull();
      expect(request.approvedAt).toBeNull();
    });

    it('cannot reject a request that is not pending', async () => {
      const { service, txRequestRepo } = createService();
      txRequestRepo.findOneBy.mockResolvedValue(approvedRequest());

      await expect(service.reject(COMPANY, 'admin-1', 'req-1', {})).rejects.toThrow(
        ConflictException,
      );
      expect(txRequestRepo.save).not.toHaveBeenCalled();
    });
  });

  // Aprobar, editar un descuento aprobado y rechazar se pueden repetir con la misma clave sin
  // resolver dos veces. Cada caso trae la solicitud como está al llegar la primera vez.
  const resolutions = [
    {
      action: 'approve' as const,
      operation: 'approveDiscountRequest',
      input: { notes: 'Ok' } as Record<string, unknown>,
      current: () => pendingRequest(),
    },
    {
      action: 'editApproved' as const,
      operation: 'editApprovedDiscount',
      input: { notes: 'Ok', approvedDiscount: '15000' } as Record<string, unknown>,
      current: () => approvedRequest(),
    },
    {
      action: 'reject' as const,
      operation: 'rejectDiscountRequest',
      input: { notes: 'Ok' } as Record<string, unknown>,
      current: () => pendingRequest(),
    },
  ];
  describe.each(resolutions)('$action with an idempotency key', ({ action, operation, input, current }) => {
    const run = (
      service: DiscountRequestService,
      key?: string,
      changes: Record<string, unknown> = {},
    ) => service[action](COMPANY, 'admin-1', 'req-1', { ...input, ...changes }, key);
    const scopeInput = () => ({ id: 'req-1', ...input });

    it('claims the key in the same transaction, before resolving, and records the request', async () => {
      const { service, manager, dataSource, txRequestRepo, txItemRepo } = createService();
      txItemRepo.find.mockResolvedValue(twoLines());
      txRequestRepo.findOneBy.mockResolvedValue(current());

      const resolved = await run(service, 'key-1');

      expect(dataSource.transaction).toHaveBeenCalledTimes(1);
      expect(manager.query).toHaveBeenNthCalledWith(
        1,
        expect.stringContaining('INSERT INTO "idempotency_keys"'),
        [COMPANY, 'admin-1', operation, 'key-1', fingerprintOf(scopeInput())],
      );
      expect(manager.query).toHaveBeenNthCalledWith(
        2,
        expect.stringContaining('UPDATE "idempotency_keys"'),
        ['claim-1', 'discount_request', resolved.id],
      );
      expect(manager.query.mock.invocationCallOrder[0]).toBeLessThan(
        txRequestRepo.save.mock.invocationCallOrder[0],
      );
    });

    it('does not claim anything without a key', async () => {
      const { service, manager, txRequestRepo, txItemRepo } = createService();
      txItemRepo.find.mockResolvedValue(twoLines());
      txRequestRepo.findOneBy.mockResolvedValue(current());

      await run(service);

      expect(manager.query).not.toHaveBeenCalled();
    });

    it('gives back the request that was already resolved when the same key comes again, without touching the sale', async () => {
      const mocks = createService();
      const { service, txRequestRepo, sales, notifications } = mocks;
      keyAlreadyUsed(mocks, scopeInput(), { resourceId: 'req-1' });
      const alreadyResolved = approvedRequest();
      txRequestRepo.findOneByOrFail.mockResolvedValue(alreadyResolved);
      // Sin la clave, el reintento fallaría: la venta ya pudo cobrarse
      sales.lockDraft.mockRejectedValue(new ConflictException('Solo se puede modificar una venta en borrador'));

      const again = await run(service, 'key-1');

      expect(again).toBe(alreadyResolved);
      expect(txRequestRepo.findOneByOrFail).toHaveBeenCalledWith({ id: 'req-1' });
      // Ni se vuelve a leer la solicitud, ni a guardar, ni a recalcular, ni se avisa otra vez
      expect(sales.lockDraft).not.toHaveBeenCalled();
      expect(txRequestRepo.findOneBy).not.toHaveBeenCalled();
      expect(txRequestRepo.save).not.toHaveBeenCalled();
      expect(sales.recalculate).not.toHaveBeenCalled();
      expect(notifications.notify).not.toHaveBeenCalled();
      expect(notifications.markEntityRead).not.toHaveBeenCalled();
      expect(notifications.signalChange).not.toHaveBeenCalled();
    });

    it('refuses the same key with other data, and resolves nothing', async () => {
      const mocks = createService();
      const { service, txRequestRepo } = mocks;
      keyAlreadyUsed(mocks, scopeInput(), { resourceId: 'req-1' });

      await expect(run(service, 'key-1', { notes: 'Otra nota' })).rejects.toThrow(ConflictException);

      expect(txRequestRepo.findOneByOrFail).not.toHaveBeenCalled();
      expect(txRequestRepo.save).not.toHaveBeenCalled();
    });
  });

  describe('cancel', () => {
    it('lets whoever asked for it cancel a pending request', async () => {
      const { service, txRequestRepo, sales } = createService();
      txRequestRepo.findOneBy.mockResolvedValue(pendingRequest());

      const request = await service.cancel(COMPANY, 'cashier-1', 'req-1', false, { notes: 'Ya no' });

      expect(request.status).toBe(DiscountRequestStatus.CANCELLED);
      expect(request.resolvedBy).toBe('cashier-1');
      expect(request.resolutionNotes).toBe('Ya no');
      expect(sales.recalculate).not.toHaveBeenCalled();
    });

    it('lets someone who can approve cancel a request that another person made', async () => {
      const { service, txRequestRepo } = createService();
      txRequestRepo.findOneBy.mockResolvedValue(pendingRequest());

      const request = await service.cancel(COMPANY, 'admin-1', 'req-1', true, {});

      expect(request.status).toBe(DiscountRequestStatus.CANCELLED);
    });

    it('does not let someone else, without permission to approve, cancel it', async () => {
      const { service, txRequestRepo } = createService();
      txRequestRepo.findOneBy.mockResolvedValue(pendingRequest());

      await expect(service.cancel(COMPANY, 'seller-1', 'req-1', false, {})).rejects.toThrow(
        ForbiddenException,
      );
      expect(txRequestRepo.save).not.toHaveBeenCalled();
    });

    it('takes the discount off the sale when it cancels an approved request on the whole sale', async () => {
      const { service, txRequestRepo, sales } = createService();
      const sale = draftSale({ generalDiscount: d('10000') });
      sales.lockDraft.mockResolvedValue(sale);
      txRequestRepo.findOneBy.mockResolvedValue(approvedRequest());

      const request = await service.cancel(COMPANY, 'cashier-1', 'req-1', false, {});

      expect(sale.generalDiscount.toFixed(2)).toBe('0.00');
      expect(sales.recalculate).toHaveBeenCalledWith(expect.anything(), sale);
      expect(request.status).toBe(DiscountRequestStatus.CANCELLED);
    });

    it('keeps who approved it, and when, when an approved request is cancelled: only the last resolution changes', async () => {
      const { service, txRequestRepo } = createService();
      const approvedAt = new Date('2026-09-24T10:00:00Z');
      txRequestRepo.findOneBy.mockResolvedValue(approvedRequest({ approvedBy: 'admin-2', approvedAt }));

      const request = await service.cancel(COMPANY, 'cashier-1', 'req-1', false, {});

      expect(request.approvedBy).toBe('admin-2');
      expect(request.approvedAt).toBe(approvedAt);
      expect(request.resolvedBy).toBe('cashier-1');
    });

    it('takes the discount off each line when it cancels an approved request on lines', async () => {
      const { service, txRequestRepo, txRequestItemRepo, txItemRepo, sales } = createService();
      const lines = [saleLine('item-1', '85500', '9500'), saleLine('item-2', '19000', '1000')];
      const items = [requestItem('item-1', '9500', '9500'), requestItem('item-2', '1000', '1000')];
      sales.lockDraft.mockResolvedValue(draftSale());
      txItemRepo.find.mockResolvedValue(lines);
      txRequestItemRepo.find.mockResolvedValue(items);
      txRequestRepo.findOneBy.mockResolvedValue(approvedRequest({ approvedDiscount: d('10500') }));

      await service.cancel(COMPANY, 'cashier-1', 'req-1', false, {});

      expect(lines[0].discountAmount.toFixed(2)).toBe('0.00');
      expect(lines[0].total.toFixed(2)).toBe('95000.00');
      expect(lines[1].discountAmount.toFixed(2)).toBe('0.00');
      expect(lines[1].total.toFixed(2)).toBe('20000.00');
      expect(txItemRepo.save).toHaveBeenCalledWith(lines);
      // Lo que se llegó a aprobar queda en la solicitud, como historial.
      expect(items[0].approvedDiscount?.toFixed(2)).toBe('9500.00');
      expect(sales.recalculate).toHaveBeenCalled();
    });

    it.each([DiscountRequestStatus.REJECTED, DiscountRequestStatus.CANCELLED])(
      'cannot cancel a request that is already %s',
      async (status) => {
        const { service, txRequestRepo } = createService();
        txRequestRepo.findOneBy.mockResolvedValue(pendingRequest({ status }));

        await expect(service.cancel(COMPANY, 'cashier-1', 'req-1', false, {})).rejects.toThrow(
          ConflictException,
        );
        expect(txRequestRepo.save).not.toHaveBeenCalled();
      },
    );

    it('only works while the sale is still a draft', async () => {
      const { service, txRequestRepo, sales } = createService();
      txRequestRepo.findOneBy.mockResolvedValue(pendingRequest());
      sales.lockDraft.mockRejectedValue(
        new ConflictException('Solo se puede modificar una venta en borrador'),
      );

      await expect(service.cancel(COMPANY, 'cashier-1', 'req-1', false, {})).rejects.toThrow(
        ConflictException,
      );
      expect(txRequestRepo.save).not.toHaveBeenCalled();
    });
  });

  // Cada paso avisa a la otra parte, dentro de la misma transacción (canal Descuentos).
  describe('notifications', () => {
    // La venta es un borrador y todavía no tiene número: el aviso habla de "una venta en curso"
    const aboutRequest = {
      companyId: COMPANY,
      entityType: NotificationEntityType.DISCOUNT_REQUEST,
      entityId: 'req-1',
      locationId: 'store-1',
      reference: null,
    };

    it('tells the administrators when a cashier asks for a discount', async () => {
      const { service, txItemRepo, notifications } = createService();
      txItemRepo.find.mockResolvedValue(twoLines());

      await service.request(COMPANY, 'cashier-1', { saleId: 'sale-1', requestedDiscount: '10000' });

      expect(notifications.findUserIdsWithPermission).toHaveBeenCalledWith(
        expect.anything(),
        COMPANY,
        'sales.approve_discount',
      );
      expect(notifications.notify).toHaveBeenCalledTimes(1);
      expect(notifications.notify).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({
          ...aboutRequest,
          type: NotificationType.DISCOUNT_REQUESTED,
          recipientIds: ['admin-1', 'admin-2'],
          actorId: 'cashier-1',
        }),
      );
    });

    it('does not tell anyone when the request is not valid', async () => {
      const { service, txItemRepo, notifications } = createService();
      txItemRepo.find.mockResolvedValue(twoLines());

      await expect(
        service.request(COMPANY, 'cashier-1', { saleId: 'sale-1', requestedDiscount: '34500.01' }),
      ).rejects.toThrow(BadRequestException);

      expect(notifications.notify).not.toHaveBeenCalled();
    });

    it('tells whoever asked when an administrator approves, and clears the "new request" notices', async () => {
      const { service, txRequestRepo, txItemRepo, notifications } = createService();
      txItemRepo.find.mockResolvedValue(twoLines());
      txRequestRepo.findOneBy.mockResolvedValue(pendingRequest());

      await service.approve(COMPANY, 'admin-1', 'req-1', {});

      expect(notifications.notify).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({
          ...aboutRequest,
          type: NotificationType.DISCOUNT_APPROVED,
          recipientIds: ['cashier-1'],
          actorId: 'admin-1',
        }),
      );
      expect(notifications.markEntityRead).toHaveBeenCalledWith(
        expect.anything(),
        NotificationEntityType.DISCOUNT_REQUEST,
        'req-1',
        [NotificationType.DISCOUNT_REQUESTED],
      );
    });

    it('does not tell anyone, nor clear anything, when the approval fails', async () => {
      const { service, txRequestRepo, txItemRepo, notifications } = createService();
      txItemRepo.find.mockResolvedValue(twoLines());
      txRequestRepo.findOneBy.mockResolvedValue(pendingRequest());

      await expect(
        service.approve(COMPANY, 'admin-1', 'req-1', { approvedDiscount: '34500.01' }),
      ).rejects.toThrow(BadRequestException);

      expect(notifications.notify).not.toHaveBeenCalled();
      expect(notifications.markEntityRead).not.toHaveBeenCalled();
    });

    it('tells whoever asked when an administrator changes an approved discount, without clearing anything', async () => {
      const { service, txRequestRepo, txItemRepo, notifications } = createService();
      txItemRepo.find.mockResolvedValue(twoLines());
      txRequestRepo.findOneBy.mockResolvedValue(approvedRequest());

      await service.editApproved(COMPANY, 'admin-2', 'req-1', { approvedDiscount: '15000' });

      expect(notifications.notify).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({
          ...aboutRequest,
          type: NotificationType.DISCOUNT_EDITED,
          recipientIds: ['cashier-1'],
          actorId: 'admin-2',
        }),
      );
      expect(notifications.markEntityRead).not.toHaveBeenCalled();
    });

    it('tells whoever asked when an administrator rejects, with the note, and clears the notices', async () => {
      const { service, txRequestRepo, notifications } = createService();
      txRequestRepo.findOneBy.mockResolvedValue(pendingRequest());

      await service.reject(COMPANY, 'admin-1', 'req-1', { notes: ' Muy alto ' });

      expect(notifications.notify).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({
          ...aboutRequest,
          type: NotificationType.DISCOUNT_REJECTED,
          recipientIds: ['cashier-1'],
          actorId: 'admin-1',
          notes: 'Muy alto',
        }),
      );
      expect(notifications.markEntityRead).toHaveBeenCalledTimes(1);
    });

    it('tells the administrators when the cashier who asked cancels a pending request, and clears the notices', async () => {
      const { service, txRequestRepo, notifications } = createService();
      txRequestRepo.findOneBy.mockResolvedValue(pendingRequest());

      await service.cancel(COMPANY, 'cashier-1', 'req-1', false, { notes: 'Ya no' });

      expect(notifications.findUserIdsWithPermission).toHaveBeenCalledWith(
        expect.anything(),
        COMPANY,
        'sales.approve_discount',
      );
      expect(notifications.notify).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({
          ...aboutRequest,
          type: NotificationType.DISCOUNT_CANCELLED,
          recipientIds: ['admin-1', 'admin-2'],
          actorId: 'cashier-1',
          notes: 'Ya no',
        }),
      );
      expect(notifications.markEntityRead).toHaveBeenCalledTimes(1);
    });

    it('tells whoever asked when an administrator cancels their request', async () => {
      const { service, txRequestRepo, notifications } = createService();
      txRequestRepo.findOneBy.mockResolvedValue(pendingRequest());

      await service.cancel(COMPANY, 'admin-1', 'req-1', true, {});

      expect(notifications.notify).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({
          type: NotificationType.DISCOUNT_CANCELLED,
          recipientIds: ['cashier-1'],
          actorId: 'admin-1',
        }),
      );
    });

    it('does not clear the "new request" notices when it cancels a request that was already approved', async () => {
      const { service, txRequestRepo, notifications } = createService();
      txRequestRepo.findOneBy.mockResolvedValue(approvedRequest());

      await service.cancel(COMPANY, 'cashier-1', 'req-1', false, {});

      expect(notifications.notify).toHaveBeenCalledTimes(1);
      expect(notifications.markEntityRead).not.toHaveBeenCalled();
    });

    it('does not tell anyone when a cancellation is not allowed', async () => {
      const { service, txRequestRepo, notifications } = createService();
      txRequestRepo.findOneBy.mockResolvedValue(pendingRequest());

      await expect(service.cancel(COMPANY, 'seller-1', 'req-1', false, {})).rejects.toThrow(
        ForbiddenException,
      );

      expect(notifications.notify).not.toHaveBeenCalled();
      expect(notifications.markEntityRead).not.toHaveBeenCalled();
      expect(notifications.signalChange).not.toHaveBeenCalled();
    });
  });

  // Además del aviso, los demás administradores reciben una señal en vivo cuando una solicitud
  // pendiente deja de estarlo, para que su lista de pendientes se ponga al día sola.
  describe('live signal to the other administrators', () => {
    const changedRequest = {
      companyId: COMPANY,
      channel: NotificationChannel.DISCOUNTS,
      entityType: NotificationEntityType.DISCOUNT_REQUEST,
      entityId: 'req-1',
      recipientIds: ['admin-1', 'admin-2'],
    };

    it('signals the administrators, except the one who approved', async () => {
      const { service, txRequestRepo, txItemRepo, notifications } = createService();
      txItemRepo.find.mockResolvedValue(twoLines());
      txRequestRepo.findOneBy.mockResolvedValue(pendingRequest());

      await service.approve(COMPANY, 'admin-1', 'req-1', {});

      expect(notifications.findUserIdsWithPermission).toHaveBeenCalledWith(
        expect.anything(),
        COMPANY,
        'sales.approve_discount',
      );
      expect(notifications.signalChange).toHaveBeenCalledTimes(1);
      expect(notifications.signalChange).toHaveBeenCalledWith(expect.anything(), {
        ...changedRequest,
        exceptUserId: 'admin-1',
      });
    });

    it('signals them when a request is rejected', async () => {
      const { service, txRequestRepo, notifications } = createService();
      txRequestRepo.findOneBy.mockResolvedValue(pendingRequest());

      await service.reject(COMPANY, 'admin-2', 'req-1', {});

      expect(notifications.signalChange).toHaveBeenCalledWith(expect.anything(), {
        ...changedRequest,
        exceptUserId: 'admin-2',
      });
    });

    it('signals them when a pending request is cancelled, except whoever cancelled it', async () => {
      const { service, txRequestRepo, notifications } = createService();
      txRequestRepo.findOneBy.mockResolvedValue(pendingRequest());

      await service.cancel(COMPANY, 'cashier-1', 'req-1', false, {});

      expect(notifications.signalChange).toHaveBeenCalledWith(expect.anything(), {
        ...changedRequest,
        exceptUserId: 'cashier-1',
      });
    });

    it('does not signal anything when the request was already approved: it was not in the pending list', async () => {
      const { service, txRequestRepo, notifications } = createService();
      txRequestRepo.findOneBy.mockResolvedValue(approvedRequest());

      await service.cancel(COMPANY, 'cashier-1', 'req-1', false, {});

      expect(notifications.signalChange).not.toHaveBeenCalled();
    });

    it('does not signal anything when a new request is made or an approved one is edited', async () => {
      const { service, txItemRepo, txRequestRepo, notifications } = createService();
      txItemRepo.find.mockResolvedValue(twoLines());

      await service.request(COMPANY, 'cashier-1', { saleId: 'sale-1', requestedDiscount: '10000' });
      txRequestRepo.findOneBy.mockResolvedValue(approvedRequest());
      await service.editApproved(COMPANY, 'admin-2', 'req-1', { approvedDiscount: '15000' });

      // Ya reciben el aviso de la solicitud nueva; y editar un descuento aprobado no cambia la lista
      expect(notifications.signalChange).not.toHaveBeenCalled();
    });

    it('does not signal anything when the operation fails', async () => {
      const { service, txRequestRepo, txItemRepo, notifications } = createService();
      txItemRepo.find.mockResolvedValue(twoLines());
      txRequestRepo.findOneBy.mockResolvedValue(pendingRequest());

      await expect(
        service.approve(COMPANY, 'admin-1', 'req-1', { approvedDiscount: '34500.01' }),
      ).rejects.toThrow(BadRequestException);

      expect(notifications.signalChange).not.toHaveBeenCalled();
    });
  });
});
