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
import { DiscountRequestStatus } from '../discount-request/entities/discount-request-status.enum.js';
import { DiscountRequest } from '../discount-request/entities/discount-request.entity.js';
import { PaymentMethod } from '../payment-method/entities/payment-method.entity.js';
import { SaleItem } from '../sale/entities/sale-item.entity.js';
import { SaleStatus } from '../sale/entities/sale-status.enum.js';
import { Sale } from '../sale/entities/sale.entity.js';
import { SalePayment } from './entities/sale-payment.entity.js';
import { SalePaymentService } from './sale-payment.service.js';

const COMPANY = 'company-1';
const d = (value: string) => new Decimal(value);
const cashier: CashActor = { userId: 'cashier-1', canViewAll: false, canManageShifts: false };

// Una venta en borrador tal como la entrega SaleService.lockDraft: vale 100000.
const draftSale = (overrides: Record<string, unknown> = {}) => ({
  id: 'sale-1',
  storeId: 'store-1',
  status: SaleStatus.DRAFT,
  total: d('100000'),
  completedAt: null,
  cashSessionId: null,
  ...overrides,
});

// El turno tal como lo entrega CashSessionService.lockOpen, con su caja cargada.
const openSession = (overrides: Record<string, unknown> = {}) => ({
  id: 'session-1',
  cashRegister: { storeId: 'store-1' },
  ...overrides,
});

const cashMethod = { id: 'method-cash', name: 'Efectivo', requiresReference: false };
const cardMethod = { id: 'method-card', name: 'Tarjeta', requiresReference: true };

const cash = (amount: string) => ({ paymentMethodId: 'method-cash', amount });
const card = (amount: string, reference?: string) => ({
  paymentMethodId: 'method-card',
  amount,
  reference,
});

const charge = (payments: { paymentMethodId: string; amount: string; reference?: string }[]) => ({
  saleId: 'sale-1',
  cashSessionId: 'session-1',
  payments,
});

function createService() {
  const paymentRepo = { find: vi.fn().mockResolvedValue([]) };
  const txPaymentRepo = {
    create: vi.fn((value: unknown) => value),
    save: vi.fn(async (value: unknown) => value),
  };
  const txRequestRepo = { update: vi.fn().mockResolvedValue(undefined) };
  const txItemRepo = { existsBy: vi.fn().mockResolvedValue(true) };
  const txMethodRepo = { find: vi.fn().mockResolvedValue([cashMethod, cardMethod]) };
  const txSaleRepo = { save: vi.fn(async (value: object) => ({ ...value })) };
  const sales = {
    findOne: vi.fn().mockResolvedValue(draftSale()),
    lockDraft: vi.fn().mockResolvedValue(draftSale()),
    recalculate: vi.fn(async (_manager: unknown, sale: object) => sale),
  };
  const cashSessions = { lockOpen: vi.fn().mockResolvedValue(openSession()) };
  // Las devoluciones: solo se usan al cobrar la venta nueva de un cambio
  const returns = {
    lockForExchange: vi.fn(),
    applyExchange: vi.fn().mockResolvedValue(undefined),
  };
  const dataSource = {
    transaction: vi.fn(async (fn: (manager: unknown) => unknown) =>
      fn({
        getRepository: (entity: unknown) =>
          entity === SalePayment
            ? txPaymentRepo
            : entity === DiscountRequest
              ? txRequestRepo
              : entity === SaleItem
                ? txItemRepo
                : entity === PaymentMethod
                  ? txMethodRepo
                  : entity === Sale
                    ? txSaleRepo
                    : undefined,
      }),
    ),
  };

  const service = new SalePaymentService(
    paymentRepo as never,
    dataSource as never,
    sales as never,
    cashSessions as never,
    returns as never,
  );
  return {
    service,
    paymentRepo,
    txPaymentRepo,
    txRequestRepo,
    txItemRepo,
    txMethodRepo,
    txSaleRepo,
    sales,
    cashSessions,
    returns,
    dataSource,
  };
}

describe('SalePaymentService', () => {
  describe('findAll', () => {
    it('lists the payments of a sale of the company in the order they were registered', async () => {
      const { service, paymentRepo, sales } = createService();

      await service.findAll(COMPANY, 'sale-1');

      expect(sales.findOne).toHaveBeenCalledWith(COMPANY, 'sale-1');
      expect(paymentRepo.find).toHaveBeenCalledWith({
        where: { saleId: 'sale-1' },
        order: { createdAt: 'ASC' },
      });
    });

    it('does not reveal the payments of a sale of another company', async () => {
      const { service, paymentRepo, sales } = createService();
      sales.findOne.mockRejectedValue(new NotFoundException('Venta sale-9 no encontrada'));

      await expect(service.findAll(COMPANY, 'sale-9')).rejects.toThrow(NotFoundException);
      expect(paymentRepo.find).not.toHaveBeenCalled();
    });
  });

  describe('complete', () => {
    it('saves the payment, completes the sale and ties it to the shift where it was paid', async () => {
      const { service, sales, txPaymentRepo, txSaleRepo } = createService();
      const sale = draftSale();
      sales.lockDraft.mockResolvedValue(sale);

      const completed = await service.complete(COMPANY, cashier, charge([cash('100000')]));

      expect(txPaymentRepo.create).toHaveBeenCalledTimes(1);
      const created = txPaymentRepo.create.mock.calls[0][0];
      expect(created).toMatchObject({
        saleId: 'sale-1',
        paymentMethodId: 'method-cash',
        reference: null,
        receivedBy: 'cashier-1',
      });
      expect(created.amount.toFixed(2)).toBe('100000.00');
      expect(txSaleRepo.save).toHaveBeenCalledWith(sale);
      expect(completed.status).toBe(SaleStatus.COMPLETED);
      expect(completed.completedAt).toBeInstanceOf(Date);
      expect(completed.cashSessionId).toBe('session-1');
    });

    it('takes several payments at once as long as they add up to the total', async () => {
      const { service, txPaymentRepo } = createService();

      await service.complete(
        COMPANY,
        cashier,
        charge([cash('70000'), card('30000', '  VOUCHER-1 ')]),
      );

      // Todos los pagos se guardan juntos, en una sola llamada
      expect(txPaymentRepo.save).toHaveBeenCalledTimes(1);
      expect(txPaymentRepo.create).toHaveBeenCalledTimes(2);
      expect(txPaymentRepo.create.mock.calls[1][0]).toMatchObject({
        paymentMethodId: 'method-card',
        reference: 'VOUCHER-1',
      });
    });

    it('adds the cents exactly, with no floating point drift', async () => {
      const { service, sales } = createService();
      sales.lockDraft.mockResolvedValue(draftSale({ total: d('0.30') }));

      // 0.1 + 0.2 = 0.30000000000000004 con números normales
      await expect(
        service.complete(COMPANY, cashier, charge([cash('0.10'), cash('0.20')])),
      ).resolves.toMatchObject({ status: SaleStatus.COMPLETED });
    });

    it('locks the sale first and the shift after, always in that order', async () => {
      const { service, sales, cashSessions } = createService();

      await service.complete(COMPANY, cashier, charge([cash('100000')]));

      expect(sales.lockDraft).toHaveBeenCalledWith(expect.anything(), COMPANY, 'sale-1');
      expect(cashSessions.lockOpen).toHaveBeenCalledWith(
        expect.anything(),
        COMPANY,
        'session-1',
        cashier,
      );
      expect(sales.lockDraft.mock.invocationCallOrder[0]).toBeLessThan(
        cashSessions.lockOpen.mock.invocationCallOrder[0],
      );
    });

    it('charges what the lines add up to today, not what was saved', async () => {
      const { service, sales } = createService();
      const sale = draftSale();
      sales.lockDraft.mockResolvedValue(sale);

      await service.complete(COMPANY, cashier, charge([cash('100000')]));

      expect(sales.recalculate).toHaveBeenCalledWith(expect.anything(), sale);
    });

    it('looks the payment methods up inside the company, only the active ones', async () => {
      const { service, txMethodRepo } = createService();

      await service.complete(COMPANY, cashier, charge([cash('50000'), card('30000', 'A'), card('20000', 'B')]));

      expect(txMethodRepo.find).toHaveBeenCalledWith({
        where: {
          id: In(['method-cash', 'method-card']),
          companyId: COMPANY,
          status: RecordStatus.ACTIVE,
        },
      });
    });

    it.each([['99999.99'], ['100000.01']])(
      'does not complete the sale when the payments add up to %s and it is worth 100000',
      async (amount) => {
        const { service, txPaymentRepo, txSaleRepo } = createService();

        await expect(service.complete(COMPANY, cashier, charge([cash(amount)]))).rejects.toThrow(
          BadRequestException,
        );
        expect(txPaymentRepo.save).not.toHaveBeenCalled();
        expect(txSaleRepo.save).not.toHaveBeenCalled();
      },
    );

    it('asks for a reference when the payment method needs one', async () => {
      const { service, txPaymentRepo } = createService();

      await expect(service.complete(COMPANY, cashier, charge([card('100000')]))).rejects.toThrow(
        BadRequestException,
      );
      await expect(
        service.complete(COMPANY, cashier, charge([card('100000', '   ')])),
      ).rejects.toThrow(BadRequestException);
      expect(txPaymentRepo.save).not.toHaveBeenCalled();
    });

    it('does not accept a payment method that is missing, inactive or of another company', async () => {
      const { service, txMethodRepo, txPaymentRepo } = createService();
      txMethodRepo.find.mockResolvedValue([]);

      await expect(service.complete(COMPANY, cashier, charge([cash('100000')]))).rejects.toThrow(
        NotFoundException,
      );
      expect(txPaymentRepo.save).not.toHaveBeenCalled();
    });

    it('needs at least one payment, and each one above zero, before touching the database', async () => {
      const { service, dataSource } = createService();

      await expect(service.complete(COMPANY, cashier, charge([]))).rejects.toThrow(
        BadRequestException,
      );
      await expect(
        service.complete(COMPANY, cashier, charge([cash('100000'), cash('0.00')])),
      ).rejects.toThrow(BadRequestException);
      expect(dataSource.transaction).not.toHaveBeenCalled();
    });

    it('charges a sale with a pending discount request instead of waiting for it: it withdraws the request and charges today’s total', async () => {
      const { service, txRequestRepo } = createService();

      await service.complete(COMPANY, cashier, charge([cash('100000')]));

      expect(txRequestRepo.update).toHaveBeenCalledWith(
        { saleId: 'sale-1', status: DiscountRequestStatus.PENDING },
        expect.objectContaining({ status: DiscountRequestStatus.CANCELLED, resolvedBy: cashier.userId }),
      );
    });

    it('does not charge a sale without lines', async () => {
      const { service, txItemRepo, txPaymentRepo } = createService();
      txItemRepo.existsBy.mockResolvedValue(false);

      await expect(service.complete(COMPANY, cashier, charge([cash('100000')]))).rejects.toThrow(
        BadRequestException,
      );
      expect(txItemRepo.existsBy).toHaveBeenCalledWith({ saleId: 'sale-1' });
      expect(txPaymentRepo.save).not.toHaveBeenCalled();
    });

    it('does not charge a sale that is worth nothing', async () => {
      const { service, sales, cashSessions } = createService();
      sales.lockDraft.mockResolvedValue(draftSale({ total: d('0') }));

      await expect(service.complete(COMPANY, cashier, charge([cash('100000')]))).rejects.toThrow(
        BadRequestException,
      );
      expect(cashSessions.lockOpen).not.toHaveBeenCalled();
    });

    it('does not charge on the shift of a register of another store', async () => {
      const { service, cashSessions, txPaymentRepo } = createService();
      cashSessions.lockOpen.mockResolvedValue(openSession({ cashRegister: { storeId: 'store-2' } }));

      await expect(service.complete(COMPANY, cashier, charge([cash('100000')]))).rejects.toThrow(
        ConflictException,
      );
      expect(txPaymentRepo.save).not.toHaveBeenCalled();
    });

    it('only completes a draft sale of the company', async () => {
      const { service, sales, cashSessions, txPaymentRepo } = createService();
      sales.lockDraft.mockRejectedValue(
        new ConflictException('Solo se puede modificar una venta en borrador'),
      );

      await expect(service.complete(COMPANY, cashier, charge([cash('100000')]))).rejects.toThrow(
        ConflictException,
      );
      expect(cashSessions.lockOpen).not.toHaveBeenCalled();
      expect(txPaymentRepo.save).not.toHaveBeenCalled();
    });

    it('only charges on a shift that is open and that the user can operate', async () => {
      const { service, cashSessions, txPaymentRepo, txSaleRepo } = createService();
      cashSessions.lockOpen.mockRejectedValue(new ForbiddenException('No es tu turno'));

      await expect(service.complete(COMPANY, cashier, charge([cash('100000')]))).rejects.toThrow(
        ForbiddenException,
      );
      expect(txPaymentRepo.save).not.toHaveBeenCalled();
      expect(txSaleRepo.save).not.toHaveBeenCalled();
    });

    it('leaves a normal sale with no credit, and never touches the returns', async () => {
      const { service, sales, returns } = createService();
      const sale = draftSale();
      sales.lockDraft.mockResolvedValue(sale);

      await service.complete(COMPANY, cashier, charge([cash('100000')]));

      expect(sale.returnCredit.toFixed(2)).toBe('0.00');
      expect(returns.lockForExchange).not.toHaveBeenCalled();
      expect(returns.applyExchange).not.toHaveBeenCalled();
    });
  });

  // La venta nueva de un cambio: el crédito de la devolución aprobada paga hasta lo que valió lo
  // devuelto, y los pagos suman solo lo que falte.
  describe('complete, when the sale is the exchange of a return', () => {
    const returned = (totalReturned: string) => ({ id: 'return-1', totalReturned: d(totalReturned) });
    const exchangeCharge = (payments: { paymentMethodId: string; amount: string }[]) => ({
      ...charge(payments),
      saleReturnId: 'return-1',
    });

    it('pays a more expensive exchange with the credit and the difference', async () => {
      const { service, sales, returns, txPaymentRepo } = createService();
      // Devuelve $100.000 y lleva uno de $130.000: el cliente paga $30.000
      const sale = draftSale({ total: d('130000') });
      sales.lockDraft.mockResolvedValue(sale);
      returns.lockForExchange.mockResolvedValue(returned('100000'));

      const completed = await service.complete(COMPANY, cashier, exchangeCharge([cash('30000')]));

      expect(returns.lockForExchange).toHaveBeenCalledWith(expect.anything(), COMPANY, 'return-1');
      expect(sale.returnCredit.toFixed(2)).toBe('100000.00');
      expect(txPaymentRepo.create).toHaveBeenCalledTimes(1);
      expect(txPaymentRepo.create.mock.calls[0][0].amount.toFixed(2)).toBe('30000.00');
      expect(completed.status).toBe(SaleStatus.COMPLETED);
    });

    it('needs no payment at all when the credit covers the whole exchange of the same value', async () => {
      const { service, sales, returns, txPaymentRepo } = createService();
      const sale = draftSale({ total: d('100000') });
      sales.lockDraft.mockResolvedValue(sale);
      returns.lockForExchange.mockResolvedValue(returned('100000'));

      const completed = await service.complete(COMPANY, cashier, exchangeCharge([]));

      expect(sale.returnCredit.toFixed(2)).toBe('100000.00');
      expect(txPaymentRepo.save).not.toHaveBeenCalled();
      expect(completed.status).toBe(SaleStatus.COMPLETED);
    });

    it('only uses the credit the exchange is worth when it is cheaper, and the rest is left to refund', async () => {
      const { service, sales, returns } = createService();
      // Devuelve $100.000 y lleva uno de $80.000: el crédito usado es $80.000
      const sale = draftSale({ total: d('80000') });
      const saleReturn = returned('100000');
      sales.lockDraft.mockResolvedValue(sale);
      returns.lockForExchange.mockResolvedValue(saleReturn);

      await service.complete(COMPANY, cashier, exchangeCharge([]));

      expect(sale.returnCredit.toFixed(2)).toBe('80000.00');
      expect(returns.applyExchange).toHaveBeenCalledTimes(1);
      const [, appliedReturn, appliedSale, credit] = returns.applyExchange.mock.calls[0];
      expect(appliedReturn).toBe(saleReturn);
      expect(appliedSale.id).toBe('sale-1');
      expect(credit.toFixed(2)).toBe('80000.00');
    });

    it('tells the return about the credit that was used, so it can finish or wait for the refund', async () => {
      const { service, sales, returns } = createService();
      sales.lockDraft.mockResolvedValue(draftSale({ total: d('130000') }));
      returns.lockForExchange.mockResolvedValue(returned('100000'));

      await service.complete(COMPANY, cashier, exchangeCharge([cash('30000')]));

      expect(returns.applyExchange.mock.calls[0][3].toFixed(2)).toBe('100000.00');
    });

    it.each([[[]], [[cash('20000')]]])(
      'does not complete the exchange when the payments do not cover what is left after the credit (payments: %j)',
      async (payments) => {
        const { service, sales, returns, txPaymentRepo, txSaleRepo } = createService();
        sales.lockDraft.mockResolvedValue(draftSale({ total: d('130000') }));
        returns.lockForExchange.mockResolvedValue(returned('100000'));

        await expect(service.complete(COMPANY, cashier, exchangeCharge(payments))).rejects.toThrow(
          BadRequestException,
        );
        expect(txPaymentRepo.save).not.toHaveBeenCalled();
        expect(txSaleRepo.save).not.toHaveBeenCalled();
        expect(returns.applyExchange).not.toHaveBeenCalled();
      },
    );

    it('says how much is left to collect after the credit', async () => {
      const { service, sales, returns } = createService();
      sales.lockDraft.mockResolvedValue(draftSale({ total: d('130000') }));
      returns.lockForExchange.mockResolvedValue(returned('100000'));

      await expect(service.complete(COMPANY, cashier, exchangeCharge([cash('20000')]))).rejects.toThrow(
        'hay que cobrar 30000.00',
      );
    });

    it('does not complete the sale when the return cannot be used, and does not even lock the shift', async () => {
      const { service, returns, cashSessions, txPaymentRepo, txSaleRepo } = createService();
      returns.lockForExchange.mockRejectedValue(new ConflictException('La devolución no está aprobada'));

      await expect(service.complete(COMPANY, cashier, exchangeCharge([cash('100000')]))).rejects.toThrow(
        ConflictException,
      );
      expect(cashSessions.lockOpen).not.toHaveBeenCalled();
      expect(txPaymentRepo.save).not.toHaveBeenCalled();
      expect(txSaleRepo.save).not.toHaveBeenCalled();
    });

    it('locks the sale first, then the return and the shift last, always in that order', async () => {
      const { service, sales, returns, cashSessions } = createService();
      sales.lockDraft.mockResolvedValue(draftSale({ total: d('100000') }));
      returns.lockForExchange.mockResolvedValue(returned('100000'));

      await service.complete(COMPANY, cashier, exchangeCharge([]));

      const order = (mock: { mock: { invocationCallOrder: number[] } }) =>
        mock.mock.invocationCallOrder[0];
      expect(order(sales.lockDraft)).toBeLessThan(order(returns.lockForExchange));
      expect(order(returns.lockForExchange)).toBeLessThan(order(cashSessions.lockOpen));
    });

    it('still asks for at least one payment when the sale is not an exchange', async () => {
      const { service, dataSource } = createService();

      await expect(service.complete(COMPANY, cashier, charge([]))).rejects.toThrow(
        BadRequestException,
      );
      expect(dataSource.transaction).not.toHaveBeenCalled();
    });
  });
});
