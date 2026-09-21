import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { Decimal } from 'decimal.js';
import { In } from 'typeorm';
import { RecordStatus } from '../../common/enums/record-status.enum.js';
import type { CashActor } from '../cash-session/cash-actor.js';
import { PaymentMethodType } from '../payment-method/entities/payment-method-type.enum.js';
import { PaymentMethod } from '../payment-method/entities/payment-method.entity.js';
import { SaleItem } from '../sale/entities/sale-item.entity.js';
import { Sale } from '../sale/entities/sale.entity.js';
import { RefundPayment } from './entities/refund-payment.entity.js';
import { SaleReturnItem } from './entities/sale-return-item.entity.js';
import { SaleReturnResolution } from './entities/sale-return-resolution.enum.js';
import {
  RESERVING_SALE_RETURN_STATUSES,
  SaleReturnStatus,
} from './entities/sale-return-status.enum.js';
import { SaleReturn } from './entities/sale-return.entity.js';
import { RETURN_SERIES } from './sale-return-number.js';
import { SaleReturnService } from './sale-return.service.js';

const COMPANY = 'company-1';
const d = (value: string) => new Decimal(value);
const cashier: CashActor = { userId: 'cashier-1', canViewAll: false, canManageShifts: false };

// Una línea de la venta original tal como la lee el servicio: lo que valió con su propio descuento
const line = (id: string, quantity: string, total: string) => ({
  id,
  description: `Zapato ${id}`,
  quantity: d(quantity),
  total: d(total),
});

// Una venta completada tal como la entrega SaleService.lockCompleted
const completedSale = (overrides: Record<string, unknown> = {}) => ({
  id: 'sale-1',
  generalDiscount: d('0'),
  ...overrides,
});

// Lo que ya se devolvió de una línea en otra devolución vigente
const previous = (saleItemId: string, quantity: string, amount: string) => ({
  saleItemId,
  quantity: d(quantity),
  amount: d(amount),
});

const requestInput = (
  items: { saleItemId: string; quantity: string }[],
  overrides: Record<string, unknown> = {},
) => ({
  saleId: 'sale-1',
  resolution: SaleReturnResolution.REFUND,
  items,
  ...overrides,
});

const saleReturn = (overrides: Record<string, unknown> = {}) => ({
  id: 'return-1',
  companyId: COMPANY,
  saleId: 'sale-1',
  returnNumber: 'DEV-00018',
  resolution: SaleReturnResolution.REFUND,
  replacementSaleId: null,
  totalReturned: d('100000'),
  refundAmount: d('0'),
  status: SaleReturnStatus.PENDING,
  reason: null,
  processedBy: 'cashier-1',
  resolvedBy: null,
  resolvedAt: null,
  resolutionNotes: null,
  completedAt: null,
  ...overrides,
});

const approvedReturn = (overrides: Record<string, unknown> = {}) =>
  saleReturn({ status: SaleReturnStatus.APPROVED, ...overrides });

const cashMethod = {
  id: 'method-cash',
  name: 'Efectivo',
  type: PaymentMethodType.CASH,
  requiresReference: false,
};
const transferMethod = {
  id: 'method-transfer',
  name: 'Transferencia',
  type: PaymentMethodType.TRANSFER,
  requiresReference: true,
};

const cashRefund = (amount: string) => ({ paymentMethodId: 'method-cash', amount });
const transferRefund = (amount: string, reference?: string) => ({
  paymentMethodId: 'method-transfer',
  amount,
  reference,
});

type RefundLine = { paymentMethodId: string; amount: string; reference?: string };

// Entregar el reembolso desde el turno 'session-1' del cajero
const refundInput = (payments: RefundLine[]) => ({
  saleReturnId: 'return-1',
  cashSessionId: 'session-1',
  payments,
});

// Entregar el reembolso sin indicar turno (solo sirve si nada sale en efectivo)
const refundInputWithoutShift = (payments: RefundLine[]) => ({
  saleReturnId: 'return-1',
  payments,
});

function createService() {
  const returnRepo = { find: vi.fn().mockResolvedValue([]), findOneBy: vi.fn() };
  const itemRepo = { find: vi.fn().mockResolvedValue([]) };
  const refundRepo = { find: vi.fn().mockResolvedValue([]) };

  // Lo que ve la transacción
  const txReturnRepo = {
    findOne: vi.fn().mockResolvedValue(saleReturn()),
    create: vi.fn((value: unknown) => value),
    save: vi.fn(async (value: object) => ({ id: 'return-1', ...value })),
  };
  const txReturnItemRepo = {
    find: vi.fn().mockResolvedValue([]),
    create: vi.fn((value: unknown) => value),
    save: vi.fn(async (value: unknown) => value),
  };
  const txLineRepo = { find: vi.fn().mockResolvedValue([line('line-1', '1', '100000')]) };
  const txRefundRepo = {
    create: vi.fn((value: unknown) => value),
    save: vi.fn(async (value: unknown) => value),
  };
  const txMethodRepo = { find: vi.fn().mockResolvedValue([cashMethod, transferMethod]) };
  const txSaleRepo = { findOneBy: vi.fn() };

  const manager = {
    getRepository: (entity: unknown) =>
      entity === SaleReturn
        ? txReturnRepo
        : entity === SaleReturnItem
          ? txReturnItemRepo
          : entity === SaleItem
            ? txLineRepo
            : entity === RefundPayment
              ? txRefundRepo
              : entity === PaymentMethod
                ? txMethodRepo
                : entity === Sale
                  ? txSaleRepo
                  : undefined,
  };
  const dataSource = {
    transaction: vi.fn(async (fn: (manager: unknown) => unknown) => fn(manager)),
  };

  const sales = { lockCompleted: vi.fn().mockResolvedValue(completedSale()) };
  const sequences = { next: vi.fn().mockResolvedValue(18) };
  const cashSessions = { lockOpen: vi.fn().mockResolvedValue({ id: 'session-1' }) };

  const service = new SaleReturnService(
    returnRepo as never,
    itemRepo as never,
    refundRepo as never,
    dataSource as never,
    sales as never,
    sequences as never,
    cashSessions as never,
  );
  return {
    service,
    returnRepo,
    itemRepo,
    refundRepo,
    txReturnRepo,
    txReturnItemRepo,
    txLineRepo,
    txRefundRepo,
    txMethodRepo,
    txSaleRepo,
    manager,
    dataSource,
    sales,
    sequences,
    cashSessions,
  };
}

describe('SaleReturnService', () => {
  describe('findAll', () => {
    it('lists the returns of the company, the most recent first', async () => {
      const { service, returnRepo } = createService();

      await service.findAll(COMPANY);

      expect(returnRepo.find).toHaveBeenCalledWith({
        where: { companyId: COMPANY },
        order: { createdAt: 'DESC' },
      });
    });

    it('filters by status, by original sale and by the sale that replaced it', async () => {
      const { service, returnRepo } = createService();

      await service.findAll(COMPANY, {
        status: SaleReturnStatus.APPROVED,
        saleId: 'sale-1',
        replacementSaleId: 'sale-2',
      });

      expect(returnRepo.find).toHaveBeenCalledWith({
        where: {
          companyId: COMPANY,
          status: SaleReturnStatus.APPROVED,
          saleId: 'sale-1',
          replacementSaleId: 'sale-2',
        },
        order: { createdAt: 'DESC' },
      });
    });
  });

  describe('findOne', () => {
    it('finds a return of the company', async () => {
      const { service, returnRepo } = createService();
      returnRepo.findOneBy.mockResolvedValue(saleReturn());

      const found = await service.findOne(COMPANY, 'return-1');

      expect(found.id).toBe('return-1');
      expect(returnRepo.findOneBy).toHaveBeenCalledWith({ id: 'return-1', companyId: COMPANY });
    });

    it('answers "not found" for a return that does not exist or belongs to another company', async () => {
      const { service, returnRepo } = createService();
      returnRepo.findOneBy.mockResolvedValue(null);

      await expect(service.findOne(COMPANY, 'return-9')).rejects.toThrow(NotFoundException);
    });
  });

  describe('findItems and findRefunds', () => {
    it('lists the lines returned in the order they were registered', async () => {
      const { service, returnRepo, itemRepo } = createService();
      returnRepo.findOneBy.mockResolvedValue(saleReturn());

      await service.findItems(COMPANY, 'return-1');

      expect(itemRepo.find).toHaveBeenCalledWith({
        where: { saleReturnId: 'return-1' },
        order: { createdAt: 'ASC' },
      });
    });

    it('lists the refunds in the order they were paid', async () => {
      const { service, returnRepo, refundRepo } = createService();
      returnRepo.findOneBy.mockResolvedValue(saleReturn());

      await service.findRefunds(COMPANY, 'return-1');

      expect(refundRepo.find).toHaveBeenCalledWith({
        where: { saleReturnId: 'return-1' },
        order: { createdAt: 'ASC' },
      });
    });

    it('does not reveal the lines or the refunds of a return of another company', async () => {
      const { service, returnRepo, itemRepo, refundRepo } = createService();
      returnRepo.findOneBy.mockResolvedValue(null);

      await expect(service.findItems(COMPANY, 'return-9')).rejects.toThrow(NotFoundException);
      await expect(service.findRefunds(COMPANY, 'return-9')).rejects.toThrow(NotFoundException);
      expect(itemRepo.find).not.toHaveBeenCalled();
      expect(refundRepo.find).not.toHaveBeenCalled();
    });
  });

  describe('request', () => {
    it('registers the return as pending, with its number, who registered it and what it is worth', async () => {
      const { service, txReturnRepo, sequences, sales, manager } = createService();

      const created = await service.request(
        COMPANY,
        'cashier-1',
        requestInput([{ saleItemId: 'line-1', quantity: '1' }], { reason: '  Le queda pequeño  ' }),
      );

      expect(sales.lockCompleted).toHaveBeenCalledWith(manager, COMPANY, 'sale-1');
      expect(sequences.next).toHaveBeenCalledWith(manager, COMPANY, RETURN_SERIES);
      const data = txReturnRepo.create.mock.calls[0][0];
      expect(data).toMatchObject({
        companyId: COMPANY,
        saleId: 'sale-1',
        returnNumber: 'DEV-00018',
        resolution: SaleReturnResolution.REFUND,
        status: SaleReturnStatus.PENDING,
        reason: 'Le queda pequeño',
        processedBy: 'cashier-1',
      });
      expect(data.totalReturned.toFixed(2)).toBe('100000.00');
      expect(data.refundAmount.toFixed(2)).toBe('0.00');
      expect(created.id).toBe('return-1');
    });

    it('keeps the type of resolution the cashier asked for', async () => {
      const { service, txReturnRepo } = createService();

      await service.request(
        COMPANY,
        'cashier-1',
        requestInput([{ saleItemId: 'line-1', quantity: '1' }], {
          resolution: SaleReturnResolution.EXCHANGE,
        }),
      );

      expect(txReturnRepo.create.mock.calls[0][0].resolution).toBe(SaleReturnResolution.EXCHANGE);
    });

    it('leaves the reason empty when it comes blank', async () => {
      const { service, txReturnRepo } = createService();

      await service.request(
        COMPANY,
        'cashier-1',
        requestInput([{ saleItemId: 'line-1', quantity: '1' }], { reason: '   ' }),
      );

      expect(txReturnRepo.create.mock.calls[0][0].reason).toBeNull();
    });

    it('saves each line returned with its quantity and its value, tied to the return', async () => {
      const { service, txReturnItemRepo, txLineRepo } = createService();
      txLineRepo.find.mockResolvedValue([
        line('line-1', '1', '100000'),
        line('line-2', '2', '50000'),
      ]);

      await service.request(
        COMPANY,
        'cashier-1',
        requestInput([
          { saleItemId: 'line-1', quantity: '1' },
          { saleItemId: 'line-2', quantity: '2' },
        ]),
      );

      const saved = txReturnItemRepo.save.mock.calls[0][0];
      expect(saved).toHaveLength(2);
      expect(saved[0]).toMatchObject({ saleReturnId: 'return-1', saleItemId: 'line-1' });
      expect(saved[0].quantity.toFixed(2)).toBe('1.00');
      expect(saved[0].amount.toFixed(2)).toBe('100000.00');
      expect(saved[1]).toMatchObject({ saleReturnId: 'return-1', saleItemId: 'line-2' });
      expect(saved[1].amount.toFixed(2)).toBe('50000.00');
    });

    it('reads the lines in creation order, so the split of the general discount is always the same', async () => {
      const { service, txLineRepo } = createService();

      await service.request(
        COMPANY,
        'cashier-1',
        requestInput([{ saleItemId: 'line-1', quantity: '1' }]),
      );

      expect(txLineRepo.find).toHaveBeenCalledWith({
        where: { saleId: 'sale-1' },
        order: { createdAt: 'ASC', id: 'ASC' },
      });
    });

    it('only counts the lines that are returned, not the whole sale', async () => {
      const { service, txReturnRepo, txLineRepo } = createService();
      txLineRepo.find.mockResolvedValue([
        line('line-1', '1', '100000'),
        line('line-2', '1', '250000'),
      ]);

      await service.request(
        COMPANY,
        'cashier-1',
        requestInput([{ saleItemId: 'line-2', quantity: '1' }]),
      );

      expect(txReturnRepo.create.mock.calls[0][0].totalReturned.toFixed(2)).toBe('250000.00');
    });

    it('values some of the units of a line in proportion to what was paid for it', async () => {
      const { service, txReturnRepo, txLineRepo } = createService();
      // Pagó 90000 por 3 pares: devolver 1 vale 30000
      txLineRepo.find.mockResolvedValue([line('line-1', '3', '90000')]);

      await service.request(
        COMPANY,
        'cashier-1',
        requestInput([{ saleItemId: 'line-1', quantity: '1' }]),
      );

      expect(txReturnRepo.create.mock.calls[0][0].totalReturned.toFixed(2)).toBe('30000.00');
    });

    it('takes the general discount of the sale into account: it returns what the customer really paid', async () => {
      const { service, txReturnRepo, txLineRepo, sales } = createService();
      // 200000 en líneas con 20000 de descuento general: cada línea de 100000 se pagó a 90000
      sales.lockCompleted.mockResolvedValue(completedSale({ generalDiscount: d('20000') }));
      txLineRepo.find.mockResolvedValue([
        line('line-1', '1', '100000'),
        line('line-2', '1', '100000'),
      ]);

      await service.request(
        COMPANY,
        'cashier-1',
        requestInput([{ saleItemId: 'line-1', quantity: '1' }]),
      );

      expect(txReturnRepo.create.mock.calls[0][0].totalReturned.toFixed(2)).toBe('90000.00');
    });

    it('returning the whole sale gives back exactly what the sale was worth, general discount included', async () => {
      const { service, txReturnRepo, txLineRepo, sales } = createService();
      // 300000 en líneas menos 30000 de descuento general: la venta valió 270000
      sales.lockCompleted.mockResolvedValue(completedSale({ generalDiscount: d('30000') }));
      txLineRepo.find.mockResolvedValue([
        line('line-1', '1', '200000'),
        line('line-2', '1', '100000'),
      ]);

      await service.request(
        COMPANY,
        'cashier-1',
        requestInput([
          { saleItemId: 'line-1', quantity: '1' },
          { saleItemId: 'line-2', quantity: '1' },
        ]),
      );

      expect(txReturnRepo.create.mock.calls[0][0].totalReturned.toFixed(2)).toBe('270000.00');
    });

    it('splits the general discount and then values part of a line', async () => {
      const { service, txReturnRepo, txLineRepo, sales } = createService();
      // Líneas de 100000 (2 pares) y 100000 (1 par), descuento general de 30000: cada una se pagó a 85000
      sales.lockCompleted.mockResolvedValue(completedSale({ generalDiscount: d('30000') }));
      txLineRepo.find.mockResolvedValue([
        line('line-1', '2', '100000'),
        line('line-2', '1', '100000'),
      ]);

      await service.request(
        COMPANY,
        'cashier-1',
        requestInput([{ saleItemId: 'line-1', quantity: '1' }]),
      );

      expect(txReturnRepo.create.mock.calls[0][0].totalReturned.toFixed(2)).toBe('42500.00');
    });

    it('returns the rest of a line for exactly what is left of what was paid, with no cents lost', async () => {
      const { service, txReturnRepo, txReturnItemRepo, txLineRepo } = createService();
      // Pagó 100,00 por 3: las dos primeras valieron 66,67 y la última tiene que valer 33,33
      txLineRepo.find.mockResolvedValue([line('line-1', '3', '100')]);
      txReturnItemRepo.find.mockResolvedValue([previous('line-1', '2', '66.67')]);

      await service.request(
        COMPANY,
        'cashier-1',
        requestInput([{ saleItemId: 'line-1', quantity: '1' }]),
      );

      expect(txReturnRepo.create.mock.calls[0][0].totalReturned.toFixed(2)).toBe('33.33');
    });

    it('adds up what was already returned from a line across several returns', async () => {
      const { service, txReturnItemRepo, txLineRepo } = createService();
      txLineRepo.find.mockResolvedValue([line('line-1', '4', '400000')]);
      txReturnItemRepo.find.mockResolvedValue([
        previous('line-1', '1', '100000'),
        previous('line-1', '2', '200000'),
      ]);

      // Quedaba 1 y se piden 2
      await expect(
        service.request(COMPANY, 'cashier-1', requestInput([{ saleItemId: 'line-1', quantity: '2' }])),
      ).rejects.toThrow('quedan 1.00 por devolver');
    });

    it('asks for the returns that are still alive (pending, approved or completed) of that sale', async () => {
      const { service, txReturnItemRepo } = createService();

      await service.request(
        COMPANY,
        'cashier-1',
        requestInput([{ saleItemId: 'line-1', quantity: '1' }]),
      );

      expect(txReturnItemRepo.find).toHaveBeenCalledWith({
        where: { saleReturn: { saleId: 'sale-1', status: In(RESERVING_SALE_RETURN_STATUSES) } },
      });
      expect(RESERVING_SALE_RETURN_STATUSES).toEqual([
        SaleReturnStatus.PENDING,
        SaleReturnStatus.APPROVED,
        SaleReturnStatus.COMPLETED,
      ]);
    });

    it('does not let more units come back than were sold', async () => {
      const { service, txLineRepo } = createService();
      txLineRepo.find.mockResolvedValue([line('line-1', '2', '200000')]);

      await expect(
        service.request(COMPANY, 'cashier-1', requestInput([{ saleItemId: 'line-1', quantity: '3' }])),
      ).rejects.toThrow('No se puede devolver más de lo vendido: de "Zapato line-1" quedan 2.00');
    });

    it('does not let a line come back again once all of it is already in another return', async () => {
      const { service, txReturnItemRepo } = createService();
      txReturnItemRepo.find.mockResolvedValue([previous('line-1', '1', '100000')]);

      await expect(
        service.request(COMPANY, 'cashier-1', requestInput([{ saleItemId: 'line-1', quantity: '1' }])),
      ).rejects.toThrow(BadRequestException);
    });

    it('does not repeat a line in the same return', async () => {
      const { service, dataSource } = createService();

      await expect(
        service.request(
          COMPANY,
          'cashier-1',
          requestInput([
            { saleItemId: 'line-1', quantity: '1' },
            { saleItemId: 'line-1', quantity: '1' },
          ]),
        ),
      ).rejects.toThrow('Una línea no puede repetirse en la devolución');
      expect(dataSource.transaction).not.toHaveBeenCalled();
    });

    it.each(['0', '0.00'])('does not accept a quantity of %s', async (quantity) => {
      const { service, dataSource } = createService();

      await expect(
        service.request(COMPANY, 'cashier-1', requestInput([{ saleItemId: 'line-1', quantity }])),
      ).rejects.toThrow('La cantidad a devolver debe ser mayor que cero');
      expect(dataSource.transaction).not.toHaveBeenCalled();
    });

    it('does not accept a line that is not part of the sale', async () => {
      const { service, txReturnRepo } = createService();

      await expect(
        service.request(COMPANY, 'cashier-1', requestInput([{ saleItemId: 'line-9', quantity: '1' }])),
      ).rejects.toThrow('Alguna de las líneas indicadas no pertenece a la venta');
      expect(txReturnRepo.save).not.toHaveBeenCalled();
    });

    it('does not register a return whose value comes to zero', async () => {
      const { service, txReturnRepo, txLineRepo, sequences } = createService();
      txLineRepo.find.mockResolvedValue([line('line-1', '1', '0')]);

      await expect(
        service.request(COMPANY, 'cashier-1', requestInput([{ saleItemId: 'line-1', quantity: '1' }])),
      ).rejects.toThrow('No hay nada que devolver');
      expect(txReturnRepo.save).not.toHaveBeenCalled();
      expect(sequences.next).not.toHaveBeenCalled();
    });

    it('only returns a sale that was completed, and does not reveal one of another company', async () => {
      const { service, sales, txReturnRepo, sequences } = createService();
      sales.lockCompleted.mockRejectedValue(
        new ConflictException('Solo se devuelve una venta completada'),
      );

      await expect(
        service.request(COMPANY, 'cashier-1', requestInput([{ saleItemId: 'line-1', quantity: '1' }])),
      ).rejects.toThrow(ConflictException);

      sales.lockCompleted.mockRejectedValue(new NotFoundException('Venta sale-9 no encontrada'));
      await expect(
        service.request(COMPANY, 'cashier-1', requestInput([{ saleItemId: 'line-1', quantity: '1' }])),
      ).rejects.toThrow(NotFoundException);
      expect(txReturnRepo.save).not.toHaveBeenCalled();
      expect(sequences.next).not.toHaveBeenCalled();
    });

    it('does not use up a return number when the return fails', async () => {
      const { service, sequences, txLineRepo } = createService();
      txLineRepo.find.mockResolvedValue([line('line-1', '1', '100000')]);

      await expect(
        service.request(COMPANY, 'cashier-1', requestInput([{ saleItemId: 'line-1', quantity: '5' }])),
      ).rejects.toThrow(BadRequestException);

      expect(sequences.next).not.toHaveBeenCalled();
    });

    it('does not touch the original sale', async () => {
      const { service, txSaleRepo } = createService();

      await service.request(
        COMPANY,
        'cashier-1',
        requestInput([{ saleItemId: 'line-1', quantity: '1' }]),
      );

      expect(txSaleRepo.findOneBy).not.toHaveBeenCalled();
    });
  });

  describe('approve', () => {
    it('approves a pending return and leaves who did it, when, and their notes', async () => {
      const { service, txReturnRepo } = createService();
      const pending = saleReturn();
      txReturnRepo.findOne.mockResolvedValue(pending);

      const approved = await service.approve(COMPANY, 'admin-1', 'return-1', {
        notes: '  Con la caja en buen estado  ',
      });

      expect(approved.status).toBe(SaleReturnStatus.APPROVED);
      expect(approved.resolvedBy).toBe('admin-1');
      expect(approved.resolvedAt).toBeInstanceOf(Date);
      expect(approved.resolutionNotes).toBe('Con la caja en buen estado');
      expect(txReturnRepo.save).toHaveBeenCalledWith(pending);
    });

    it('locks the return of the company before deciding', async () => {
      const { service, txReturnRepo } = createService();

      await service.approve(COMPANY, 'admin-1', 'return-1', {});

      expect(txReturnRepo.findOne).toHaveBeenCalledWith({
        where: { id: 'return-1', companyId: COMPANY },
        lock: { mode: 'pessimistic_write' },
      });
    });

    it('leaves the notes empty when there are none', async () => {
      const { service } = createService();

      const approved = await service.approve(COMPANY, 'admin-1', 'return-1', { notes: '   ' });

      expect(approved.resolutionNotes).toBeNull();
    });

    it.each([
      SaleReturnStatus.APPROVED,
      SaleReturnStatus.COMPLETED,
      SaleReturnStatus.REJECTED,
      SaleReturnStatus.CANCELLED,
    ])('does not approve a return that is already %s', async (status) => {
      const { service, txReturnRepo } = createService();
      txReturnRepo.findOne.mockResolvedValue(saleReturn({ status }));

      await expect(service.approve(COMPANY, 'admin-1', 'return-1', {})).rejects.toThrow(
        'La devolución ya fue resuelta',
      );
      expect(txReturnRepo.save).not.toHaveBeenCalled();
    });

    it('does not reveal a return of another company', async () => {
      const { service, txReturnRepo } = createService();
      txReturnRepo.findOne.mockResolvedValue(null);

      await expect(service.approve(COMPANY, 'admin-1', 'return-9', {})).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  describe('reject', () => {
    it('rejects a pending return and leaves who did it and why', async () => {
      const { service, txReturnRepo } = createService();
      const pending = saleReturn();
      txReturnRepo.findOne.mockResolvedValue(pending);

      const rejected = await service.reject(COMPANY, 'admin-1', 'return-1', {
        notes: 'Zapato usado',
      });

      expect(rejected.status).toBe(SaleReturnStatus.REJECTED);
      expect(rejected.resolvedBy).toBe('admin-1');
      expect(rejected.resolvedAt).toBeInstanceOf(Date);
      expect(rejected.resolutionNotes).toBe('Zapato usado');
      expect(txReturnRepo.save).toHaveBeenCalledWith(pending);
    });

    it.each([
      SaleReturnStatus.APPROVED,
      SaleReturnStatus.COMPLETED,
      SaleReturnStatus.REJECTED,
      SaleReturnStatus.CANCELLED,
    ])('does not reject a return that is already %s', async (status) => {
      const { service, txReturnRepo } = createService();
      txReturnRepo.findOne.mockResolvedValue(saleReturn({ status }));

      await expect(service.reject(COMPANY, 'admin-1', 'return-1', {})).rejects.toThrow(
        'La devolución ya fue resuelta',
      );
      expect(txReturnRepo.save).not.toHaveBeenCalled();
    });

    it('does not reveal a return of another company', async () => {
      const { service, txReturnRepo } = createService();
      txReturnRepo.findOne.mockResolvedValue(null);

      await expect(service.reject(COMPANY, 'admin-1', 'return-9', {})).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  describe('cancel', () => {
    it('lets whoever registered a pending return cancel it, even without the approval permission', async () => {
      const { service, txReturnRepo } = createService();
      txReturnRepo.findOne.mockResolvedValue(saleReturn({ processedBy: 'cashier-1' }));

      const cancelled = await service.cancel(COMPANY, 'cashier-1', 'return-1', false, {
        notes: 'El cliente se arrepintió',
      });

      expect(cancelled.status).toBe(SaleReturnStatus.CANCELLED);
      expect(cancelled.resolvedBy).toBe('cashier-1');
      expect(cancelled.resolutionNotes).toBe('El cliente se arrepintió');
    });

    it('lets whoever registered an approved return cancel it', async () => {
      const { service, txReturnRepo } = createService();
      txReturnRepo.findOne.mockResolvedValue(approvedReturn());

      const cancelled = await service.cancel(COMPANY, 'cashier-1', 'return-1', false, {});

      expect(cancelled.status).toBe(SaleReturnStatus.CANCELLED);
    });

    it('lets someone who can approve returns cancel one that somebody else registered', async () => {
      const { service, txReturnRepo } = createService();
      txReturnRepo.findOne.mockResolvedValue(saleReturn({ processedBy: 'cashier-1' }));

      const cancelled = await service.cancel(COMPANY, 'admin-1', 'return-1', true, {});

      expect(cancelled.status).toBe(SaleReturnStatus.CANCELLED);
      expect(cancelled.resolvedBy).toBe('admin-1');
    });

    it('does not let another cashier cancel a return they did not register', async () => {
      const { service, txReturnRepo } = createService();
      txReturnRepo.findOne.mockResolvedValue(saleReturn({ processedBy: 'cashier-1' }));

      await expect(
        service.cancel(COMPANY, 'cashier-2', 'return-1', false, {}),
      ).rejects.toThrow(ForbiddenException);
      expect(txReturnRepo.save).not.toHaveBeenCalled();
    });

    it.each([
      SaleReturnStatus.COMPLETED,
      SaleReturnStatus.REJECTED,
      SaleReturnStatus.CANCELLED,
    ])('does not cancel a return that is already %s', async (status) => {
      const { service, txReturnRepo } = createService();
      txReturnRepo.findOne.mockResolvedValue(saleReturn({ status }));

      await expect(service.cancel(COMPANY, 'cashier-1', 'return-1', true, {})).rejects.toThrow(
        'La devolución ya no se puede cancelar',
      );
      expect(txReturnRepo.save).not.toHaveBeenCalled();
    });

    it('does not cancel an exchange whose new sale was already charged: the difference still has to be refunded', async () => {
      const { service, txReturnRepo } = createService();
      txReturnRepo.findOne.mockResolvedValue(
        approvedReturn({
          resolution: SaleReturnResolution.PARTIAL_REFUND,
          replacementSaleId: 'sale-2',
        }),
      );

      await expect(service.cancel(COMPANY, 'admin-1', 'return-1', true, {})).rejects.toThrow(
        'La devolución ya tiene un cambio cobrado',
      );
      expect(txReturnRepo.save).not.toHaveBeenCalled();
    });

    it('does not reveal a return of another company', async () => {
      const { service, txReturnRepo } = createService();
      txReturnRepo.findOne.mockResolvedValue(null);

      await expect(service.cancel(COMPANY, 'admin-1', 'return-9', true, {})).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  describe('completeRefund', () => {
    it('gives the money back, completes the return and leaves the refund tied to the shift and to who paid it', async () => {
      const { service, txReturnRepo, txRefundRepo, cashSessions, manager } = createService();
      const approved = approvedReturn();
      txReturnRepo.findOne.mockResolvedValue(approved);

      const completed = await service.completeRefund(
        COMPANY,
        cashier,
        refundInput([cashRefund('100000')]),
      );

      expect(cashSessions.lockOpen).toHaveBeenCalledWith(manager, COMPANY, 'session-1', cashier);
      expect(txRefundRepo.create).toHaveBeenCalledTimes(1);
      const created = txRefundRepo.create.mock.calls[0][0];
      expect(created).toMatchObject({
        saleReturnId: 'return-1',
        paymentMethodId: 'method-cash',
        reference: null,
        cashSessionId: 'session-1',
        paidBy: 'cashier-1',
      });
      expect(created.amount.toFixed(2)).toBe('100000.00');
      expect(completed.status).toBe(SaleReturnStatus.COMPLETED);
      expect(completed.refundAmount.toFixed(2)).toBe('100000.00');
      expect(completed.completedAt).toBeInstanceOf(Date);
      expect(txReturnRepo.save).toHaveBeenCalledWith(approved);
    });

    it('splits the refund between several ways to pay, and the cash is the only part that comes out of the drawer', async () => {
      const { service, txReturnRepo, txRefundRepo } = createService();
      txReturnRepo.findOne.mockResolvedValue(approvedReturn());

      await service.completeRefund(
        COMPANY,
        cashier,
        refundInput([cashRefund('60000'), transferRefund('40000', '  TRF-77  ')]),
      );

      const saved = txRefundRepo.save.mock.calls[0][0];
      expect(saved).toHaveLength(2);
      expect(saved[0].amount.toFixed(2)).toBe('60000.00');
      expect(saved[1].amount.toFixed(2)).toBe('40000.00');
      expect(saved[1].reference).toBe('TRF-77');
    });

    it('refunds by transfer without a shift, because it does not touch the drawer', async () => {
      const { service, txReturnRepo, txRefundRepo, cashSessions } = createService();
      txReturnRepo.findOne.mockResolvedValue(approvedReturn());

      const completed = await service.completeRefund(
        COMPANY,
        cashier,
        refundInputWithoutShift([transferRefund('100000', 'TRF-1')]),
      );

      expect(cashSessions.lockOpen).not.toHaveBeenCalled();
      expect(txRefundRepo.create.mock.calls[0][0].cashSessionId).toBeNull();
      expect(completed.status).toBe(SaleReturnStatus.COMPLETED);
    });

    it('needs the shift when any of the refund is in cash', async () => {
      const { service, txReturnRepo, txRefundRepo } = createService();
      txReturnRepo.findOne.mockResolvedValue(approvedReturn());

      await expect(
        service.completeRefund(
          COMPANY,
          cashier,
          refundInputWithoutShift([cashRefund('60000'), transferRefund('40000', 'TRF-1')]),
        ),
      ).rejects.toThrow('El reembolso en efectivo sale de un turno de caja: indica el turno');
      expect(txRefundRepo.save).not.toHaveBeenCalled();
    });

    it('does not refund from a shift that is not open or is not the cashier’s', async () => {
      const { service, txReturnRepo, txRefundRepo, cashSessions } = createService();
      txReturnRepo.findOne.mockResolvedValue(approvedReturn());
      cashSessions.lockOpen.mockRejectedValue(
        new ForbiddenException('Solo el cajero asignado al turno puede operar la caja'),
      );

      await expect(
        service.completeRefund(COMPANY, cashier, refundInput([cashRefund('100000')])),
      ).rejects.toThrow(ForbiddenException);
      expect(txRefundRepo.save).not.toHaveBeenCalled();
      expect(txReturnRepo.save).not.toHaveBeenCalled();
    });

    it('locks the return first and the shift after, always in that order', async () => {
      const { service, txReturnRepo, cashSessions } = createService();
      txReturnRepo.findOne.mockResolvedValue(approvedReturn());

      await service.completeRefund(COMPANY, cashier, refundInput([cashRefund('100000')]));

      expect(txReturnRepo.findOne.mock.invocationCallOrder[0]).toBeLessThan(
        cashSessions.lockOpen.mock.invocationCallOrder[0],
      );
    });

    it.each([['99999.99'], ['100000.01'], ['50000']])(
      'refunds exactly what has to be returned, not %s',
      async (amount) => {
        const { service, txReturnRepo, txRefundRepo } = createService();
        txReturnRepo.findOne.mockResolvedValue(approvedReturn());

        await expect(
          service.completeRefund(COMPANY, cashier, refundInput([cashRefund(amount)])),
        ).rejects.toThrow('tienen que ser iguales');
        expect(txRefundRepo.save).not.toHaveBeenCalled();
        expect(txReturnRepo.save).not.toHaveBeenCalled();
      },
    );

    it('says how much there is to return and how much was given', async () => {
      const { service, txReturnRepo } = createService();
      txReturnRepo.findOne.mockResolvedValue(approvedReturn());

      await expect(
        service.completeRefund(COMPANY, cashier, refundInput([cashRefund('80000')])),
      ).rejects.toThrow('Los reembolsos suman 80000.00 y hay que devolver 100000.00');
    });

    it('asks for the reference when the way to pay requires it', async () => {
      const { service, txReturnRepo, txRefundRepo } = createService();
      txReturnRepo.findOne.mockResolvedValue(approvedReturn());

      await expect(
        service.completeRefund(
          COMPANY,
          cashier,
          refundInputWithoutShift([transferRefund('100000')]),
        ),
      ).rejects.toThrow('El medio de pago Transferencia exige una referencia');
      expect(txRefundRepo.save).not.toHaveBeenCalled();
    });

    it('only accepts active ways to pay of the company', async () => {
      const { service, txReturnRepo, txMethodRepo, txRefundRepo } = createService();
      txReturnRepo.findOne.mockResolvedValue(approvedReturn());
      txMethodRepo.find.mockResolvedValue([]);

      await expect(
        service.completeRefund(COMPANY, cashier, refundInput([cashRefund('100000')])),
      ).rejects.toThrow(NotFoundException);
      expect(txMethodRepo.find).toHaveBeenCalledWith({
        where: { id: In(['method-cash']), companyId: COMPANY, status: RecordStatus.ACTIVE },
      });
      expect(txRefundRepo.save).not.toHaveBeenCalled();
    });

    it('does not accept a refund of zero, and does not even open the transaction', async () => {
      const { service, dataSource } = createService();

      await expect(
        service.completeRefund(COMPANY, cashier, refundInput([cashRefund('0')])),
      ).rejects.toThrow('Cada reembolso debe ser mayor que cero');
      expect(dataSource.transaction).not.toHaveBeenCalled();
    });

    it('does not refund a return that is still pending', async () => {
      const { service, txReturnRepo, cashSessions } = createService();
      txReturnRepo.findOne.mockResolvedValue(saleReturn());

      await expect(
        service.completeRefund(COMPANY, cashier, refundInput([cashRefund('100000')])),
      ).rejects.toThrow('La devolución todavía no está aprobada');
      expect(cashSessions.lockOpen).not.toHaveBeenCalled();
    });

    it('does not refund a return twice', async () => {
      const { service, txReturnRepo, txRefundRepo } = createService();
      txReturnRepo.findOne.mockResolvedValue(saleReturn({ status: SaleReturnStatus.COMPLETED }));

      await expect(
        service.completeRefund(COMPANY, cashier, refundInput([cashRefund('100000')])),
      ).rejects.toThrow('La devolución ya está completada');
      expect(txRefundRepo.save).not.toHaveBeenCalled();
    });

    it.each([SaleReturnStatus.REJECTED, SaleReturnStatus.CANCELLED])(
      'does not refund a return that was %s',
      async (status) => {
        const { service, txReturnRepo } = createService();
        txReturnRepo.findOne.mockResolvedValue(saleReturn({ status }));

        await expect(
          service.completeRefund(COMPANY, cashier, refundInput([cashRefund('100000')])),
        ).rejects.toThrow('La devolución fue rechazada o cancelada');
      },
    );

    it('has nothing to refund on an exchange whose new sale has not been charged yet', async () => {
      const { service, txReturnRepo, txRefundRepo } = createService();
      txReturnRepo.findOne.mockResolvedValue(
        approvedReturn({ resolution: SaleReturnResolution.EXCHANGE }),
      );

      await expect(
        service.completeRefund(COMPANY, cashier, refundInput([cashRefund('100000')])),
      ).rejects.toThrow('Esta devolución es un cambio: falta cobrar la venta nueva');
      expect(txRefundRepo.save).not.toHaveBeenCalled();
    });

    describe('the difference of an exchange for something cheaper', () => {
      // Devolvió 100000 y el cambio valió 80000, con lo que el crédito usado fue 80000: sobran 20000
      const partial = () =>
        approvedReturn({
          resolution: SaleReturnResolution.PARTIAL_REFUND,
          replacementSaleId: 'sale-2',
        });

      it('refunds only what was left of the credit, and completes the return', async () => {
        const { service, txReturnRepo, txSaleRepo, txRefundRepo } = createService();
        txReturnRepo.findOne.mockResolvedValue(partial());
        txSaleRepo.findOneBy.mockResolvedValue({ id: 'sale-2', returnCredit: d('80000') });

        const completed = await service.completeRefund(
          COMPANY,
          cashier,
          refundInput([cashRefund('20000')]),
        );

        expect(txSaleRepo.findOneBy).toHaveBeenCalledWith({ id: 'sale-2' });
        expect(txRefundRepo.create.mock.calls[0][0].amount.toFixed(2)).toBe('20000.00');
        expect(completed.status).toBe(SaleReturnStatus.COMPLETED);
        expect(completed.refundAmount.toFixed(2)).toBe('20000.00');
      });

      it('does not refund everything that was returned, because part of it already paid for the exchange', async () => {
        const { service, txReturnRepo, txSaleRepo, txRefundRepo } = createService();
        txReturnRepo.findOne.mockResolvedValue(partial());
        txSaleRepo.findOneBy.mockResolvedValue({ id: 'sale-2', returnCredit: d('80000') });

        await expect(
          service.completeRefund(COMPANY, cashier, refundInput([cashRefund('100000')])),
        ).rejects.toThrow('Los reembolsos suman 100000.00 y hay que devolver 20000.00');
        expect(txRefundRepo.save).not.toHaveBeenCalled();
      });

      it('fails when the sale of the exchange cannot be found', async () => {
        const { service, txReturnRepo, txSaleRepo } = createService();
        txReturnRepo.findOne.mockResolvedValue(partial());
        txSaleRepo.findOneBy.mockResolvedValue(null);

        await expect(
          service.completeRefund(COMPANY, cashier, refundInput([cashRefund('20000')])),
        ).rejects.toThrow('No se encontró la venta del cambio');
      });
    });
  });

  describe('lockForExchange', () => {
    it('gives the return of an approved exchange that has not been charged yet, locked', async () => {
      const { service, txReturnRepo, manager } = createService();
      const exchange = approvedReturn({ resolution: SaleReturnResolution.EXCHANGE });
      txReturnRepo.findOne.mockResolvedValue(exchange);

      const locked = await service.lockForExchange(manager as never, COMPANY, 'return-1');

      expect(locked).toBe(exchange);
      expect(txReturnRepo.findOne).toHaveBeenCalledWith({
        where: { id: 'return-1', companyId: COMPANY },
        lock: { mode: 'pessimistic_write' },
      });
    });

    it.each([
      SaleReturnStatus.PENDING,
      SaleReturnStatus.COMPLETED,
      SaleReturnStatus.REJECTED,
      SaleReturnStatus.CANCELLED,
    ])('does not use a return that is %s', async (status) => {
      const { service, txReturnRepo, manager } = createService();
      txReturnRepo.findOne.mockResolvedValue(
        saleReturn({ status, resolution: SaleReturnResolution.EXCHANGE }),
      );

      await expect(service.lockForExchange(manager as never, COMPANY, 'return-1')).rejects.toThrow(
        'La devolución no está aprobada',
      );
    });

    it('does not use a return that is a refund, not an exchange', async () => {
      const { service, txReturnRepo, manager } = createService();
      txReturnRepo.findOne.mockResolvedValue(approvedReturn());

      await expect(service.lockForExchange(manager as never, COMPANY, 'return-1')).rejects.toThrow(
        'La devolución no es un cambio',
      );
    });

    it('does not use the same return for a second exchange', async () => {
      const { service, txReturnRepo, manager } = createService();
      txReturnRepo.findOne.mockResolvedValue(
        approvedReturn({ resolution: SaleReturnResolution.EXCHANGE, replacementSaleId: 'sale-2' }),
      );

      await expect(service.lockForExchange(manager as never, COMPANY, 'return-1')).rejects.toThrow(
        'La devolución ya tiene su cambio cobrado',
      );
    });

    it('says the exchange is already charged when it went to a partial refund', async () => {
      const { service, txReturnRepo, manager } = createService();
      txReturnRepo.findOne.mockResolvedValue(
        approvedReturn({
          resolution: SaleReturnResolution.PARTIAL_REFUND,
          replacementSaleId: 'sale-2',
        }),
      );

      await expect(service.lockForExchange(manager as never, COMPANY, 'return-1')).rejects.toThrow(
        'La devolución ya tiene su cambio cobrado',
      );
    });

    it('does not reveal a return of another company', async () => {
      const { service, txReturnRepo, manager } = createService();
      txReturnRepo.findOne.mockResolvedValue(null);

      await expect(service.lockForExchange(manager as never, COMPANY, 'return-9')).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  describe('applyExchange', () => {
    it('completes the return when the credit covered everything that was returned', async () => {
      const { service, txReturnRepo, manager } = createService();
      const exchange = approvedReturn({ resolution: SaleReturnResolution.EXCHANGE });

      await service.applyExchange(
        manager as never,
        exchange as never,
        { id: 'sale-2' } as never,
        d('100000'),
      );

      expect(exchange.replacementSaleId).toBe('sale-2');
      expect(exchange.status).toBe(SaleReturnStatus.COMPLETED);
      expect(exchange.completedAt).toBeInstanceOf(Date);
      expect(exchange.resolution).toBe(SaleReturnResolution.EXCHANGE);
      expect(txReturnRepo.save).toHaveBeenCalledWith(exchange);
    });

    it('turns into a partial refund, still approved, when the exchange was cheaper', async () => {
      const { service, txReturnRepo, manager } = createService();
      const exchange = approvedReturn({ resolution: SaleReturnResolution.EXCHANGE });

      await service.applyExchange(
        manager as never,
        exchange as never,
        { id: 'sale-2' } as never,
        d('80000'),
      );

      expect(exchange.replacementSaleId).toBe('sale-2');
      expect(exchange.resolution).toBe(SaleReturnResolution.PARTIAL_REFUND);
      expect(exchange.status).toBe(SaleReturnStatus.APPROVED);
      expect(exchange.completedAt).toBeNull();
      expect(txReturnRepo.save).toHaveBeenCalledWith(exchange);
    });

    it('takes a credit of even one cent less than what was returned as a partial refund', async () => {
      const { service, manager } = createService();
      const exchange = approvedReturn({ resolution: SaleReturnResolution.EXCHANGE });

      await service.applyExchange(
        manager as never,
        exchange as never,
        { id: 'sale-2' } as never,
        d('99999.99'),
      );

      expect(exchange.resolution).toBe(SaleReturnResolution.PARTIAL_REFUND);
    });
  });
});
