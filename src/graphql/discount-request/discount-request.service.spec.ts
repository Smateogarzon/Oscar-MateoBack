import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { Decimal } from 'decimal.js';
import { In } from 'typeorm';
import { SaleItem } from '../sale/entities/sale-item.entity.js';
import { SaleStatus } from '../sale/entities/sale-status.enum.js';
import { DiscountRequestService } from './discount-request.service.js';
import { DiscountRequestItem } from './entities/discount-request-item.entity.js';
import {
  ACTIVE_DISCOUNT_REQUEST_STATUSES,
  DiscountRequestStatus,
} from './entities/discount-request-status.enum.js';
import { DiscountRequest } from './entities/discount-request.entity.js';

const COMPANY = 'company-1';
const d = (value: string) => new Decimal(value);

// La venta tal como la deja SaleService.lockDraft: bloqueada y en borrador.
const draftSale = (overrides: Record<string, unknown> = {}) => ({
  id: 'sale-1',
  companyId: COMPANY,
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
  ...overrides,
});

const approvedRequest = (overrides: Record<string, unknown> = {}) =>
  pendingRequest({
    status: DiscountRequestStatus.APPROVED,
    approvedDiscount: d('10000'),
    ...overrides,
  });

// La venta de los ejemplos: una línea de 95000 y otra de 20000, 115000 en total. El tope del 30 %
// es 34500 sobre toda la venta, 28500 sobre la primera línea y 6000 sobre la segunda.
const twoLines = () => [saleLine('item-1', '95000'), saleLine('item-2', '20000')];

function createService() {
  const requestRepo = { find: vi.fn().mockResolvedValue([]), findOne: vi.fn() };
  const requestItemRepo = { find: vi.fn().mockResolvedValue([]) };
  const txRequestRepo = {
    existsBy: vi.fn().mockResolvedValue(false),
    findOneBy: vi.fn(),
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
  const sales = {
    lockDraft: vi.fn().mockResolvedValue(draftSale()),
    recalculate: vi.fn(async (_manager: unknown, sale: object) => sale),
  };
  const dataSource = {
    transaction: vi.fn(async (fn: (manager: unknown) => unknown) =>
      fn({
        getRepository: (entity: unknown) =>
          entity === DiscountRequest
            ? txRequestRepo
            : entity === DiscountRequestItem
              ? txRequestItemRepo
              : entity === SaleItem
                ? txItemRepo
                : txSaleRepo,
      }),
    ),
  };

  const service = new DiscountRequestService(
    requestRepo as never,
    requestItemRepo as never,
    dataSource as never,
    sales as never,
  );
  return {
    service,
    requestRepo,
    requestItemRepo,
    txRequestRepo,
    txRequestItemRepo,
    txItemRepo,
    txSaleRepo,
    sales,
    dataSource,
  };
}

describe('DiscountRequestService', () => {
  describe('findAll', () => {
    it('only lists the requests of sales of the company, newest first', async () => {
      const { service, requestRepo } = createService();

      await service.findAll(COMPANY);

      expect(requestRepo.find).toHaveBeenCalledWith({
        where: { sale: { companyId: COMPANY } },
        order: { requestedAt: 'DESC' },
      });
    });

    it('can narrow the list down by status and sale', async () => {
      const { service, requestRepo } = createService();

      await service.findAll(COMPANY, { status: DiscountRequestStatus.PENDING, saleId: 'sale-1' });

      expect(requestRepo.find).toHaveBeenCalledWith({
        where: {
          sale: { companyId: COMPANY },
          status: DiscountRequestStatus.PENDING,
          saleId: 'sale-1',
        },
        order: { requestedAt: 'DESC' },
      });
    });
  });

  describe('findOne and findItems', () => {
    it('answers a request of another company as if it did not exist', async () => {
      const { service, requestRepo } = createService();
      requestRepo.findOne.mockResolvedValue(null);

      await expect(service.findOne(COMPANY, 'req-9')).rejects.toThrow(NotFoundException);
      expect(requestRepo.findOne).toHaveBeenCalledWith({
        where: { id: 'req-9', sale: { companyId: COMPANY } },
      });
    });

    it('lists the amounts per line of a request of the company', async () => {
      const { service, requestRepo, requestItemRepo } = createService();
      requestRepo.findOne.mockResolvedValue(pendingRequest());

      await service.findItems(COMPANY, 'req-1');

      expect(requestItemRepo.find).toHaveBeenCalledWith({ where: { discountRequestId: 'req-1' } });
    });

    it('does not reveal the lines of a request of another company', async () => {
      const { service, requestRepo, requestItemRepo } = createService();
      requestRepo.findOne.mockResolvedValue(null);

      await expect(service.findItems(COMPANY, 'req-9')).rejects.toThrow(NotFoundException);
      expect(requestItemRepo.find).not.toHaveBeenCalled();
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

    it('cannot reject a request that is not pending', async () => {
      const { service, txRequestRepo } = createService();
      txRequestRepo.findOneBy.mockResolvedValue(approvedRequest());

      await expect(service.reject(COMPANY, 'admin-1', 'req-1', {})).rejects.toThrow(
        ConflictException,
      );
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
});
