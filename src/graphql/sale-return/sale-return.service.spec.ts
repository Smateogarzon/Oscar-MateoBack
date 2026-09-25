import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { Decimal } from 'decimal.js';
import { In, Not } from 'typeorm';
import { RecordStatus } from '../../common/enums/record-status.enum.js';
import type { CashActor } from '../cash-session/cash-actor.js';
import { IdempotencyKey } from '../idempotency/entities/idempotency-key.entity.js';
import { fingerprintOf } from '../idempotency/idempotency.js';
import { NotificationChannel } from '../notification/entities/notification-channel.enum.js';
import { NotificationEntityType } from '../notification/entities/notification-entity-type.enum.js';
import { NotificationType } from '../notification/entities/notification-type.enum.js';
import { PaymentMethodType } from '../payment-method/entities/payment-method-type.enum.js';
import { PaymentMethod } from '../payment-method/entities/payment-method.entity.js';
import { SaleItem } from '../sale/entities/sale-item.entity.js';
import { Sale } from '../sale/entities/sale.entity.js';
import type { SaleActor } from '../sale/sale-actor.js';
import { UserLocationAccess } from '../user-location-access/entities/user-location-access.entity.js';
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
// Quien entrega un reembolso: el cajero del turno
const cashier: CashActor = { userId: 'cashier-1', canViewAll: false, canManageShifts: false };
// Quien pide una devolución o consulta: el cajero, que solo ve lo suyo, y quien aprueba o ve todo
const cashierActor: SaleActor = { userId: 'cashier-1', canViewAll: false, canReadAny: false };
const approverActor: SaleActor = { userId: 'admin-1', canViewAll: false, canReadAny: true };

// Una línea de la venta original tal como la lee el servicio: lo que valió con su propio descuento
const line = (id: string, quantity: string, total: string) => ({
  id,
  description: `Zapato ${id}`,
  quantity: d(quantity),
  total: d(total),
});

// Una venta completada tal como la entrega SaleService.lockCompleted: la cobró 'cashier-1' en 'store-1'
const completedSale = (overrides: Record<string, unknown> = {}) => ({
  id: 'sale-1',
  storeId: 'store-1',
  saleNumber: 'VTA-000125',
  cashierId: 'cashier-1',
  sellerId: null,
  generalDiscount: d('0'),
  ...overrides,
});

// La venta original que lee completeRefund y el aviso para ubicar la tienda
const originalSale = () => ({ id: 'sale-1', storeId: 'store-1' });

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
  approvedBy: null,
  approvedAt: null,
  lastEditedBy: null,
  lastEditedAt: null,
  cancelledBy: null,
  cancelledAt: null,
  completedAt: null,
  ...overrides,
});

const approvedReturn = (overrides: Record<string, unknown> = {}) =>
  saleReturn({ status: SaleReturnStatus.APPROVED, ...overrides });

// Una devolución tal como la entrega una consulta: con su venta original cargada
const returnWithSale = (overrides: Record<string, unknown> = {}) =>
  saleReturn({
    sale: { id: 'sale-1', cashierId: 'cashier-1', sellerId: null, saleNumber: 'VTA-000125' },
    ...overrides,
  });

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
  const returnRepo = { find: vi.fn().mockResolvedValue([]), findOne: vi.fn() };
  const itemRepo = { find: vi.fn().mockResolvedValue([]) };
  const refundRepo = { find: vi.fn().mockResolvedValue([]) };
  // La venta que se busca fuera de una transacción (la de un cambio, o el número de la original)
  const saleRepo = { findOneBy: vi.fn().mockResolvedValue(null), findOne: vi.fn() };

  // Lo que ve la transacción
  const txReturnRepo = {
    findOne: vi.fn().mockResolvedValue(saleReturn()),
    findOneBy: vi.fn().mockResolvedValue(saleReturn()),
    // La carga de un reintento con clave: el recurso tal como está ahora
    findOneByOrFail: vi.fn(async ({ id }: { id: string }) => saleReturn({ id })),
    create: vi.fn((value: unknown) => value),
    save: vi.fn(async (value: object) => ({ id: 'return-1', ...value })),
  };
  const txReturnItemRepo = {
    find: vi.fn().mockResolvedValue([]),
    delete: vi.fn().mockResolvedValue(undefined),
    create: vi.fn((value: unknown) => value),
    save: vi.fn(async (value: unknown) => value),
  };
  const txLineRepo = { find: vi.fn().mockResolvedValue([line('line-1', '1', '100000')]) };
  const txRefundRepo = {
    create: vi.fn((value: unknown) => value),
    save: vi.fn(async (value: unknown) => value),
  };
  const txMethodRepo = { find: vi.fn().mockResolvedValue([cashMethod, transferMethod]) };
  const txSaleRepo = {
    findOneBy: vi.fn().mockResolvedValue(originalSale()),
    save: vi.fn(),
    update: vi.fn(),
  };
  // ¿Tiene acceso a la tienda? (assertStoreAccess)
  const txAccessRepo = { existsBy: vi.fn().mockResolvedValue(true) };
  // La fila de la clave de idempotencia que quedó guardada, si la hay
  const txKeyRepo = { findOneBy: vi.fn().mockResolvedValue(null) };

  const repositories = new Map<unknown, unknown>([
    [SaleReturn, txReturnRepo],
    [SaleReturnItem, txReturnItemRepo],
    [SaleItem, txLineRepo],
    [RefundPayment, txRefundRepo],
    [PaymentMethod, txMethodRepo],
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

  const sales = { lockCompleted: vi.fn().mockResolvedValue(completedSale()) };
  const sequences = { next: vi.fn().mockResolvedValue(18) };
  // El turno bloqueado trae su caja, y la caja su tienda
  const cashSessions = {
    lockOpen: vi.fn().mockResolvedValue({ id: 'session-1', cashRegister: { storeId: 'store-1' } }),
    findOne: vi.fn().mockResolvedValue({ id: 'session-1' }),
  };
  // Los administradores de la empresa, que son quienes reciben las devoluciones
  const notifications = {
    notify: vi.fn().mockResolvedValue(null),
    findUserIdsWithPermission: vi.fn().mockResolvedValue(['admin-1', 'admin-2']),
    markEntityRead: vi.fn().mockResolvedValue(0),
    signalChange: vi.fn(),
  };

  const service = new SaleReturnService(
    returnRepo as never,
    itemRepo as never,
    refundRepo as never,
    dataSource as never,
    sales as never,
    sequences as never,
    cashSessions as never,
    notifications as never,
  );
  return {
    service,
    returnRepo,
    itemRepo,
    refundRepo,
    saleRepo,
    txReturnRepo,
    txReturnItemRepo,
    txLineRepo,
    txRefundRepo,
    txMethodRepo,
    txSaleRepo,
    txAccessRepo,
    txKeyRepo,
    manager,
    dataSource,
    sales,
    sequences,
    cashSessions,
    notifications,
  };
}

// Una clave que ya se usó: el INSERT que intenta reclamarla no devuelve fila y la que quedó guardada
// apunta a `resourceId`, con la huella de `input` (o la que se diga).
function keyAlreadyUsed(
  mocks: ReturnType<typeof createService>,
  input: unknown,
  { resourceId = 'return-7' as string | null, fingerprint = fingerprintOf(input) } = {},
) {
  mocks.manager.query.mockResolvedValueOnce([]);
  mocks.txKeyRepo.findOneBy.mockResolvedValue({ fingerprint, resourceId });
}

// La venta de un cambio: `findOneBy` responde según el id, porque la venta original también se lee por ahí
const withExchangeSale = (
  txSaleRepo: { findOneBy: ReturnType<typeof vi.fn> },
  exchangeSale: unknown,
) =>
  txSaleRepo.findOneBy.mockImplementation(async ({ id }: { id: string }) =>
    id === 'sale-2' ? exchangeSale : originalSale(),
  );

describe('SaleReturnService', () => {
  describe('findAll', () => {
    it('lists the returns of the company, the most recent first, up to 500 by default', async () => {
      const { service, returnRepo } = createService();

      await service.findAll(COMPANY, approverActor);

      expect(returnRepo.find).toHaveBeenCalledWith({
        where: [{ companyId: COMPANY }],
        relations: { sale: true },
        order: { createdAt: 'DESC' },
        take: 500,
        skip: 0,
      });
    });

    it('filters by status, by original sale and by the sale that replaced it', async () => {
      const { service, returnRepo } = createService();

      await service.findAll(COMPANY, approverActor, {
        status: SaleReturnStatus.APPROVED,
        saleId: 'sale-1',
        replacementSaleId: 'sale-2',
      });

      expect(returnRepo.find).toHaveBeenCalledWith(
        expect.objectContaining({
          where: [
            {
              companyId: COMPANY,
              status: SaleReturnStatus.APPROVED,
              saleId: 'sale-1',
              replacementSaleId: 'sale-2',
            },
          ],
        }),
      );
    });

    it('lets whoever sees all the sales see every return of the company', async () => {
      const { service, returnRepo } = createService();

      await service.findAll(COMPANY, { userId: 'viewer-1', canViewAll: true, canReadAny: true });

      expect(returnRepo.find).toHaveBeenCalledWith(
        expect.objectContaining({ where: [{ companyId: COMPANY }] }),
      );
    });

    it('shows whoever cannot see everything only the returns of their own sales and the ones they registered', async () => {
      const { service, returnRepo } = createService();

      await service.findAll(COMPANY, cashierActor);

      expect(returnRepo.find).toHaveBeenCalledWith(
        expect.objectContaining({
          where: [
            { companyId: COMPANY, sale: { cashierId: 'cashier-1' } },
            { companyId: COMPANY, sale: { sellerId: 'cashier-1' } },
            { companyId: COMPANY, replacementSale: { cashierId: 'cashier-1' } },
            { companyId: COMPANY, processedBy: 'cashier-1' },
          ],
        }),
      );
    });

    it('keeps the filters in every alternative, so a filter never shows more than the asker may see', async () => {
      const { service, returnRepo } = createService();

      await service.findAll(COMPANY, cashierActor, {
        status: SaleReturnStatus.PENDING,
        saleId: 'sale-1',
      });

      const { where } = returnRepo.find.mock.calls[0][0];
      expect(where).toHaveLength(4);
      for (const alternative of where) {
        expect(alternative).toMatchObject({
          companyId: COMPANY,
          status: SaleReturnStatus.PENDING,
          saleId: 'sale-1',
        });
      }
    });

    it.each([
      [undefined, 500],
      [0, 1],
      [-5, 1],
      [300, 300],
      [5000, 1000],
    ])('takes a limit of %s as %s', async (limit, take) => {
      const { service, returnRepo } = createService();

      await service.findAll(COMPANY, approverActor, { limit });

      expect(returnRepo.find.mock.calls[0][0].take).toBe(take);
    });

    it.each([
      [undefined, 0],
      [-3, 0],
      [20, 20],
    ])('takes an offset of %s as %s', async (offset, skip) => {
      const { service, returnRepo } = createService();

      await service.findAll(COMPANY, approverActor, { offset });

      expect(returnRepo.find.mock.calls[0][0].skip).toBe(skip);
    });
  });

  describe('findOne', () => {
    it('finds a return of the company, with its original sale, without asking who is asking', async () => {
      const { service, returnRepo } = createService();
      returnRepo.findOne.mockResolvedValue(returnWithSale());

      const found = await service.findOne(COMPANY, 'return-1');

      expect(found.id).toBe('return-1');
      expect(returnRepo.findOne).toHaveBeenCalledWith({
        where: { id: 'return-1', companyId: COMPANY },
        relations: { sale: true },
      });
    });

    it('answers "not found" for a return that does not exist or belongs to another company', async () => {
      const { service, returnRepo } = createService();
      returnRepo.findOne.mockResolvedValue(null);

      await expect(service.findOne(COMPANY, 'return-9')).rejects.toThrow(NotFoundException);
    });
  });

  describe('findVisible', () => {
    // Una devolución de la venta de otro cajero, registrada por otro
    const someoneElses = (overrides: Record<string, unknown> = {}) =>
      returnWithSale({
        processedBy: 'cashier-2',
        sale: { id: 'sale-1', cashierId: 'cashier-2', sellerId: 'seller-1' },
        ...overrides,
      });

    it('shows a return the asker registered themselves', async () => {
      const { service, returnRepo } = createService();
      returnRepo.findOne.mockResolvedValue(someoneElses({ processedBy: 'cashier-1' }));

      const found = await service.findVisible(COMPANY, cashierActor, 'return-1');

      expect(found.id).toBe('return-1');
    });

    it('shows the return of a sale the asker charged', async () => {
      const { service, returnRepo } = createService();
      returnRepo.findOne.mockResolvedValue(
        someoneElses({ sale: { id: 'sale-1', cashierId: 'cashier-1', sellerId: null } }),
      );

      await expect(service.findVisible(COMPANY, cashierActor, 'return-1')).resolves.toMatchObject({
        id: 'return-1',
      });
    });

    it('shows the return of a sale the asker sold', async () => {
      const { service, returnRepo } = createService();
      returnRepo.findOne.mockResolvedValue(
        someoneElses({ sale: { id: 'sale-1', cashierId: 'cashier-2', sellerId: 'cashier-1' } }),
      );

      await expect(service.findVisible(COMPANY, cashierActor, 'return-1')).resolves.toMatchObject({
        id: 'return-1',
      });
    });

    it('shows the return of an exchange whose new sale the asker charged', async () => {
      const { service, returnRepo, saleRepo } = createService();
      returnRepo.findOne.mockResolvedValue(someoneElses({ replacementSaleId: 'sale-2' }));
      saleRepo.findOneBy.mockResolvedValue({ id: 'sale-2' });

      await expect(service.findVisible(COMPANY, cashierActor, 'return-1')).resolves.toMatchObject({
        id: 'return-1',
      });
      expect(saleRepo.findOneBy).toHaveBeenCalledWith({ id: 'sale-2', cashierId: 'cashier-1' });
    });

    it('lets whoever can read every sale, or approve, see any return without looking anything else up', async () => {
      const { service, returnRepo, saleRepo } = createService();
      returnRepo.findOne.mockResolvedValue(someoneElses());

      await expect(service.findVisible(COMPANY, approverActor, 'return-1')).resolves.toMatchObject({
        id: 'return-1',
      });
      expect(saleRepo.findOneBy).not.toHaveBeenCalled();
    });

    it('answers "not found" for the return of somebody else\'s sale, as if it did not exist', async () => {
      const { service, returnRepo, saleRepo } = createService();
      returnRepo.findOne.mockResolvedValue(someoneElses());

      await expect(service.findVisible(COMPANY, cashierActor, 'return-1')).rejects.toThrow(
        NotFoundException,
      );
      // No hay cambio cobrado que mirar
      expect(saleRepo.findOneBy).not.toHaveBeenCalled();
    });

    it('answers "not found" when the exchange of somebody else\'s return was not charged by the asker either', async () => {
      const { service, returnRepo, saleRepo } = createService();
      returnRepo.findOne.mockResolvedValue(someoneElses({ replacementSaleId: 'sale-2' }));
      saleRepo.findOneBy.mockResolvedValue(null);

      await expect(service.findVisible(COMPANY, cashierActor, 'return-1')).rejects.toThrow(
        NotFoundException,
      );
    });

    it('answers "not found" for a return of another company', async () => {
      const { service, returnRepo } = createService();
      returnRepo.findOne.mockResolvedValue(null);

      await expect(service.findVisible(COMPANY, approverActor, 'return-9')).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  describe('saleNumberOf', () => {
    it('takes the number from the original sale when the list already loaded it', async () => {
      const { service, dataSource } = createService();

      const number = await service.saleNumberOf(returnWithSale() as never);

      expect(number).toBe('VTA-000125');
      expect(dataSource.getRepository).not.toHaveBeenCalled();
    });

    it('looks the sale up when the return comes on its own (the result of a mutation)', async () => {
      const { service, saleRepo } = createService();
      saleRepo.findOne.mockResolvedValue({ id: 'sale-1', saleNumber: 'VTA-000125' });

      const number = await service.saleNumberOf(saleReturn() as never);

      expect(number).toBe('VTA-000125');
      expect(saleRepo.findOne).toHaveBeenCalledWith({
        where: { id: 'sale-1' },
        select: { id: true, saleNumber: true },
      });
    });

    it('is null when the sale has no number or cannot be found', async () => {
      const { service, saleRepo } = createService();
      saleRepo.findOne.mockResolvedValueOnce({ id: 'sale-1', saleNumber: null });
      saleRepo.findOne.mockResolvedValueOnce(null);

      await expect(service.saleNumberOf(saleReturn() as never)).resolves.toBeNull();
      await expect(service.saleNumberOf(saleReturn() as never)).resolves.toBeNull();
    });
  });

  describe('findItems and findRefunds', () => {
    it('lists the lines returned in the order they were registered', async () => {
      const { service, returnRepo, itemRepo } = createService();
      returnRepo.findOne.mockResolvedValue(returnWithSale());

      await service.findItems(COMPANY, cashierActor, 'return-1');

      expect(itemRepo.find).toHaveBeenCalledWith({
        where: { saleReturnId: 'return-1' },
        order: { createdAt: 'ASC' },
      });
    });

    it('lists the refunds in the order they were paid', async () => {
      const { service, returnRepo, refundRepo } = createService();
      returnRepo.findOne.mockResolvedValue(returnWithSale());

      await service.findRefunds(COMPANY, cashierActor, 'return-1');

      expect(refundRepo.find).toHaveBeenCalledWith({
        where: { saleReturnId: 'return-1' },
        order: { createdAt: 'ASC' },
      });
    });

    it('lists the refunds paid out of a shift, each with the number of its return', async () => {
      const { service, cashSessions, refundRepo } = createService();
      refundRepo.find.mockResolvedValue([
        { id: 'refund-1', saleReturnId: 'return-1', cashSessionId: 'session-1', saleReturn: { returnNumber: 'DEV-000018' } },
        { id: 'refund-2', saleReturnId: 'return-2', cashSessionId: 'session-1', saleReturn: { returnNumber: 'DEV-000019' } },
      ]);

      const refunds = await service.findRefundsInSession(COMPANY, cashier, 'session-1');

      expect(cashSessions.findOne).toHaveBeenCalledWith(COMPANY, cashier, 'session-1');
      expect(refundRepo.find).toHaveBeenCalledWith({
        where: { cashSessionId: 'session-1' },
        relations: { saleReturn: true },
        order: { createdAt: 'ASC' },
      });
      expect(refunds.map((refund) => [refund.id, refund.returnNumber])).toEqual([
        ['refund-1', 'DEV-000018'],
        ['refund-2', 'DEV-000019'],
      ]);
    });

    it('does not reveal the refunds of a shift the asker cannot see', async () => {
      const { service, cashSessions, refundRepo } = createService();
      cashSessions.findOne.mockRejectedValue(new NotFoundException('Turno session-9 no encontrado'));

      await expect(service.findRefundsInSession(COMPANY, cashier, 'session-9')).rejects.toThrow(NotFoundException);
      expect(refundRepo.find).not.toHaveBeenCalled();
    });

    it('does not reveal the lines or the refunds of a return of another company', async () => {
      const { service, returnRepo, itemRepo, refundRepo } = createService();
      returnRepo.findOne.mockResolvedValue(null);

      await expect(service.findItems(COMPANY, cashierActor, 'return-9')).rejects.toThrow(NotFoundException);
      await expect(service.findRefunds(COMPANY, cashierActor, 'return-9')).rejects.toThrow(NotFoundException);
      expect(itemRepo.find).not.toHaveBeenCalled();
      expect(refundRepo.find).not.toHaveBeenCalled();
    });

    it('does not reveal the lines or the refunds of a return of somebody else\'s sale', async () => {
      const { service, returnRepo, itemRepo, refundRepo } = createService();
      returnRepo.findOne.mockResolvedValue(
        returnWithSale({
          processedBy: 'cashier-2',
          sale: { id: 'sale-1', cashierId: 'cashier-2', sellerId: null },
        }),
      );

      await expect(service.findItems(COMPANY, cashierActor, 'return-1')).rejects.toThrow(NotFoundException);
      await expect(service.findRefunds(COMPANY, cashierActor, 'return-1')).rejects.toThrow(NotFoundException);
      expect(itemRepo.find).not.toHaveBeenCalled();
      expect(refundRepo.find).not.toHaveBeenCalled();
    });

    it('lets whoever can read every sale see the lines and the refunds of any return', async () => {
      const { service, returnRepo, itemRepo, refundRepo } = createService();
      returnRepo.findOne.mockResolvedValue(
        returnWithSale({
          processedBy: 'cashier-2',
          sale: { id: 'sale-1', cashierId: 'cashier-2', sellerId: null },
        }),
      );

      await service.findItems(COMPANY, approverActor, 'return-1');
      await service.findRefunds(COMPANY, approverActor, 'return-1');

      expect(itemRepo.find).toHaveBeenCalledTimes(1);
      expect(refundRepo.find).toHaveBeenCalledTimes(1);
    });
  });

  describe('request', () => {
    it('registers the return as pending, with its number, who registered it and what it is worth', async () => {
      const { service, txReturnRepo, sequences, sales, manager } = createService();

      const created = await service.request(
        COMPANY,
        cashierActor,
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
        cashierActor,
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
        cashierActor,
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
        cashierActor,
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
        cashierActor,
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
        cashierActor,
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
        cashierActor,
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
        cashierActor,
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
        cashierActor,
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
        cashierActor,
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
        cashierActor,
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
        service.request(COMPANY, cashierActor, requestInput([{ saleItemId: 'line-1', quantity: '2' }])),
      ).rejects.toThrow('quedan 1.00 por devolver');
    });

    it('asks for the returns that are still alive (pending, approved or completed) of that sale', async () => {
      const { service, txReturnItemRepo } = createService();

      await service.request(
        COMPANY,
        cashierActor,
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
        service.request(COMPANY, cashierActor, requestInput([{ saleItemId: 'line-1', quantity: '3' }])),
      ).rejects.toThrow('No se puede devolver más de lo vendido: de "Zapato line-1" quedan 2.00');
    });

    it('does not let a line come back again once all of it is already in another return', async () => {
      const { service, txReturnItemRepo } = createService();
      txReturnItemRepo.find.mockResolvedValue([previous('line-1', '1', '100000')]);

      await expect(
        service.request(COMPANY, cashierActor, requestInput([{ saleItemId: 'line-1', quantity: '1' }])),
      ).rejects.toThrow(BadRequestException);
    });

    it('does not repeat a line in the same return', async () => {
      const { service, dataSource } = createService();

      await expect(
        service.request(
          COMPANY,
          cashierActor,
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
        service.request(COMPANY, cashierActor, requestInput([{ saleItemId: 'line-1', quantity }])),
      ).rejects.toThrow('La cantidad a devolver debe ser mayor que cero');
      expect(dataSource.transaction).not.toHaveBeenCalled();
    });

    it('does not accept a line that is not part of the sale', async () => {
      const { service, txReturnRepo } = createService();

      await expect(
        service.request(COMPANY, cashierActor, requestInput([{ saleItemId: 'line-9', quantity: '1' }])),
      ).rejects.toThrow('Alguna de las líneas indicadas no pertenece a la venta');
      expect(txReturnRepo.save).not.toHaveBeenCalled();
    });

    it('does not register a return whose value comes to zero', async () => {
      const { service, txReturnRepo, txLineRepo, sequences } = createService();
      txLineRepo.find.mockResolvedValue([line('line-1', '1', '0')]);

      await expect(
        service.request(COMPANY, cashierActor, requestInput([{ saleItemId: 'line-1', quantity: '1' }])),
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
        service.request(COMPANY, cashierActor, requestInput([{ saleItemId: 'line-1', quantity: '1' }])),
      ).rejects.toThrow(ConflictException);

      sales.lockCompleted.mockRejectedValue(new NotFoundException('Venta sale-9 no encontrada'));
      await expect(
        service.request(COMPANY, cashierActor, requestInput([{ saleItemId: 'line-1', quantity: '1' }])),
      ).rejects.toThrow(NotFoundException);
      expect(txReturnRepo.save).not.toHaveBeenCalled();
      expect(sequences.next).not.toHaveBeenCalled();
    });

    it('does not use up a return number when the return fails', async () => {
      const { service, sequences, txLineRepo } = createService();
      txLineRepo.find.mockResolvedValue([line('line-1', '1', '100000')]);

      await expect(
        service.request(COMPANY, cashierActor, requestInput([{ saleItemId: 'line-1', quantity: '5' }])),
      ).rejects.toThrow(BadRequestException);

      expect(sequences.next).not.toHaveBeenCalled();
    });

    it('does not change the original sale: it only reads it, to know the store the notice belongs to', async () => {
      const { service, txSaleRepo } = createService();

      await service.request(
        COMPANY,
        cashierActor,
        requestInput([{ saleItemId: 'line-1', quantity: '1' }]),
      );

      expect(txSaleRepo.findOneBy).toHaveBeenCalledWith({ id: 'sale-1' });
      expect(txSaleRepo.save).not.toHaveBeenCalled();
      expect(txSaleRepo.update).not.toHaveBeenCalled();
    });

    it('locks the sale before it uses up a number or registers anything', async () => {
      const { service, sales, sequences, txReturnRepo } = createService();

      await service.request(
        COMPANY,
        cashierActor,
        requestInput([{ saleItemId: 'line-1', quantity: '1' }]),
      );

      expect(sales.lockCompleted.mock.invocationCallOrder[0]).toBeLessThan(
        sequences.next.mock.invocationCallOrder[0],
      );
      expect(sales.lockCompleted.mock.invocationCallOrder[0]).toBeLessThan(
        txReturnRepo.save.mock.invocationCallOrder[0],
      );
    });

    describe('who can register it', () => {
      it('does not register a return of a sale that is not the asker\'s, and answers as if the sale did not exist', async () => {
        const { service, sales, sequences, txReturnRepo, txAccessRepo, notifications } = createService();
        sales.lockCompleted.mockResolvedValue(
          completedSale({ cashierId: 'cashier-2', sellerId: 'seller-1' }),
        );

        await expect(
          service.request(COMPANY, cashierActor, requestInput([{ saleItemId: 'line-1', quantity: '1' }])),
        ).rejects.toThrow(NotFoundException);

        // Ni el consecutivo, ni el registro, ni el aviso, ni siquiera mirar la tienda
        expect(txAccessRepo.existsBy).not.toHaveBeenCalled();
        expect(sequences.next).not.toHaveBeenCalled();
        expect(txReturnRepo.save).not.toHaveBeenCalled();
        expect(notifications.notify).not.toHaveBeenCalled();
      });

      it.each([
        ['the cashier who charged it', { cashierId: 'cashier-1', sellerId: null }],
        ['the seller who sold it', { cashierId: 'cashier-2', sellerId: 'cashier-1' }],
      ])('lets %s register it', async (_who, sale) => {
        const { service, sales } = createService();
        sales.lockCompleted.mockResolvedValue(completedSale(sale));

        await expect(
          service.request(COMPANY, cashierActor, requestInput([{ saleItemId: 'line-1', quantity: '1' }])),
        ).resolves.toMatchObject({ id: 'return-1' });
      });

      it('lets whoever can read any sale register a return of a sale that is not theirs, as the one who registered it', async () => {
        const { service, sales, txReturnRepo, txAccessRepo } = createService();
        sales.lockCompleted.mockResolvedValue(
          completedSale({ cashierId: 'cashier-2', sellerId: 'seller-1' }),
        );

        await service.request(
          COMPANY,
          approverActor,
          requestInput([{ saleItemId: 'line-1', quantity: '1' }]),
        );

        expect(txReturnRepo.create.mock.calls[0][0].processedBy).toBe('admin-1');
        // Ver la venta no exime de tener la tienda asignada
        expect(txAccessRepo.existsBy).toHaveBeenCalledWith(
          expect.objectContaining({ userId: 'admin-1', locationId: 'store-1' }),
        );
      });

      it.each([
        ['a cashier', cashierActor],
        ['an approver', approverActor],
      ])('needs access to the store where the sale was made, for %s, and does not use up a number', async (_who, actor) => {
        const { service, sequences, txReturnRepo, txAccessRepo, notifications } = createService();
        txAccessRepo.existsBy.mockResolvedValue(false);

        await expect(
          service.request(COMPANY, actor, requestInput([{ saleItemId: 'line-1', quantity: '1' }])),
        ).rejects.toThrow(ForbiddenException);

        expect(txAccessRepo.existsBy).toHaveBeenCalledWith({
          userId: actor.userId,
          locationId: 'store-1',
          status: RecordStatus.ACTIVE,
        });
        expect(sequences.next).not.toHaveBeenCalled();
        expect(txReturnRepo.save).not.toHaveBeenCalled();
        expect(notifications.notify).not.toHaveBeenCalled();
      });
    });

    describe('with an idempotency key', () => {
      const input = requestInput([{ saleItemId: 'line-1', quantity: '1' }]);

      it('claims the key in the same transaction as the return and records what was created', async () => {
        const { service, manager, dataSource, txReturnRepo } = createService();

        const created = await service.request(COMPANY, cashierActor, input, 'key-1');

        expect(dataSource.transaction).toHaveBeenCalledTimes(1);
        expect(manager.query).toHaveBeenNthCalledWith(
          1,
          expect.stringContaining('INSERT INTO "idempotency_keys"'),
          [COMPANY, 'cashier-1', 'requestSaleReturn', 'key-1', fingerprintOf(input)],
        );
        expect(manager.query).toHaveBeenNthCalledWith(
          2,
          expect.stringContaining('UPDATE "idempotency_keys"'),
          ['claim-1', 'sale_return', created.id],
        );
        // La clave se reclama antes de hacer nada
        expect(manager.query.mock.invocationCallOrder[0]).toBeLessThan(
          txReturnRepo.save.mock.invocationCallOrder[0],
        );
      });

      it('does not claim anything when the request comes without a key', async () => {
        const { service, manager, txKeyRepo } = createService();

        await service.request(COMPANY, cashierActor, input);

        expect(manager.query).not.toHaveBeenCalled();
        expect(txKeyRepo.findOneBy).not.toHaveBeenCalled();
      });

      it('gives back the return that was already registered when the same key comes again, without registering another', async () => {
        const mocks = createService();
        const { service, manager, txKeyRepo, txReturnRepo, txReturnItemRepo, sales, sequences, notifications } = mocks;
        keyAlreadyUsed(mocks, input);

        const again = await service.request(COMPANY, cashierActor, input, 'key-1');

        expect(again.id).toBe('return-7');
        expect(txKeyRepo.findOneBy).toHaveBeenCalledWith({
          companyId: COMPANY,
          userId: 'cashier-1',
          operation: 'requestSaleReturn',
          key: 'key-1',
        });
        expect(txReturnRepo.findOneByOrFail).toHaveBeenCalledWith({ id: 'return-7' });
        // Solo el intento de reclamar: no hay nada que registrar en el reintento
        expect(manager.query).toHaveBeenCalledTimes(1);
        expect(sales.lockCompleted).not.toHaveBeenCalled();
        expect(sequences.next).not.toHaveBeenCalled();
        expect(txReturnRepo.save).not.toHaveBeenCalled();
        expect(txReturnItemRepo.save).not.toHaveBeenCalled();
        expect(notifications.notify).not.toHaveBeenCalled();
      });

      it('refuses the same key with other data, and registers nothing', async () => {
        const mocks = createService();
        const { service, txReturnRepo, sequences } = mocks;
        keyAlreadyUsed(mocks, input);

        await expect(
          service.request(
            COMPANY,
            cashierActor,
            requestInput([{ saleItemId: 'line-1', quantity: '2' }]),
            'key-1',
          ),
        ).rejects.toThrow(ConflictException);

        expect(txReturnRepo.findOneByOrFail).not.toHaveBeenCalled();
        expect(txReturnRepo.save).not.toHaveBeenCalled();
        expect(sequences.next).not.toHaveBeenCalled();
      });

      it('says the operation is still going on when the key was claimed but has no result yet', async () => {
        const mocks = createService();
        const { service, txReturnRepo } = mocks;
        keyAlreadyUsed(mocks, input, { resourceId: null });

        await expect(service.request(COMPANY, cashierActor, input, 'key-1')).rejects.toThrow(
          'Esta operación ya está en curso',
        );
        expect(txReturnRepo.save).not.toHaveBeenCalled();
      });
    });
  });

  describe('edit', () => {
    const editInput = (overrides: Record<string, unknown> = {}) => ({
      items: [{ saleItemId: 'line-1', quantity: '1' }],
      ...overrides,
    });

    it('replaces the lines of a pending return, values them again, and leaves who edited it and when', async () => {
      const { service, txReturnRepo, txReturnItemRepo, txLineRepo } = createService();
      const pending = saleReturn({ totalReturned: d('200000') });
      txReturnRepo.findOne.mockResolvedValue(pending);
      // Pagó 200000 por 2 pares: devolver 1 vale 100000
      txLineRepo.find.mockResolvedValue([line('line-1', '2', '200000')]);

      const edited = await service.edit(COMPANY, 'admin-1', 'return-1', editInput());

      expect(txReturnItemRepo.delete).toHaveBeenCalledWith({ saleReturnId: 'return-1' });
      const saved = txReturnItemRepo.save.mock.calls[0][0];
      expect(saved).toHaveLength(1);
      expect(saved[0]).toMatchObject({ saleReturnId: 'return-1', saleItemId: 'line-1' });
      expect(saved[0].amount.toFixed(2)).toBe('100000.00');
      expect(edited.totalReturned.toFixed(2)).toBe('100000.00');
      expect(edited.status).toBe(SaleReturnStatus.PENDING);
      expect(edited.lastEditedBy).toBe('admin-1');
      expect(edited.lastEditedAt).toBeInstanceOf(Date);
      // Editar no es resolver: no cambia quién la resolvió ni quién la aprobó
      expect(edited.resolvedBy).toBeNull();
      expect(edited.approvedBy).toBeNull();
      expect(txReturnRepo.save).toHaveBeenCalledWith(pending);
    });

    it('takes out the old lines before saving the new ones', async () => {
      const { service, txReturnItemRepo } = createService();

      await service.edit(COMPANY, 'admin-1', 'return-1', editInput());

      expect(txReturnItemRepo.delete.mock.invocationCallOrder[0]).toBeLessThan(
        txReturnItemRepo.save.mock.invocationCallOrder[0],
      );
    });

    it('changes the resolution and the reason when they come, and trims the reason', async () => {
      const { service } = createService();

      const edited = await service.edit(
        COMPANY,
        'admin-1',
        'return-1',
        editInput({ resolution: SaleReturnResolution.EXCHANGE, reason: '  Otra talla  ' }),
      );

      expect(edited.resolution).toBe(SaleReturnResolution.EXCHANGE);
      expect(edited.reason).toBe('Otra talla');
    });

    it('keeps the resolution and the reason when they do not come, and clears the reason when it comes blank', async () => {
      const { service, txReturnRepo } = createService();
      txReturnRepo.findOne.mockResolvedValue(
        saleReturn({ resolution: SaleReturnResolution.EXCHANGE, reason: 'Le queda pequeño' }),
      );

      const kept = await service.edit(COMPANY, 'admin-1', 'return-1', editInput());
      expect(kept.resolution).toBe(SaleReturnResolution.EXCHANGE);
      expect(kept.reason).toBe('Le queda pequeño');

      txReturnRepo.findOne.mockResolvedValue(saleReturn({ reason: 'Le queda pequeño' }));
      const cleared = await service.edit(COMPANY, 'admin-1', 'return-1', editInput({ reason: '   ' }));
      expect(cleared.reason).toBeNull();
    });

    it('values the lines without counting what this same return already had', async () => {
      const { service, txReturnItemRepo } = createService();

      await service.edit(COMPANY, 'admin-1', 'return-1', editInput());

      expect(txReturnItemRepo.find).toHaveBeenCalledWith({
        where: {
          saleReturn: {
            saleId: 'sale-1',
            status: In(RESERVING_SALE_RETURN_STATUSES),
            id: Not('return-1'),
          },
        },
      });
    });

    it('locks the sale first and the return after, always in that order', async () => {
      const { service, sales, txReturnRepo } = createService();

      await service.edit(COMPANY, 'admin-1', 'return-1', editInput());

      // Primero se lee la devolución sin bloquear, solo para saber cuál es su venta
      expect(txReturnRepo.findOneBy).toHaveBeenCalledWith({ id: 'return-1', companyId: COMPANY });
      expect(sales.lockCompleted).toHaveBeenCalledWith(expect.anything(), COMPANY, 'sale-1');
      expect(sales.lockCompleted.mock.invocationCallOrder[0]).toBeLessThan(
        txReturnRepo.findOne.mock.invocationCallOrder[0],
      );
      expect(txReturnRepo.findOne).toHaveBeenCalledWith({
        where: { id: 'return-1', companyId: COMPANY },
        lock: { mode: 'pessimistic_write' },
      });
    });

    it.each([
      SaleReturnStatus.APPROVED,
      SaleReturnStatus.COMPLETED,
      SaleReturnStatus.REJECTED,
      SaleReturnStatus.CANCELLED,
    ])('does not edit a return that is already %s', async (status) => {
      const { service, txReturnRepo, txReturnItemRepo } = createService();
      txReturnRepo.findOne.mockResolvedValue(saleReturn({ status }));

      await expect(service.edit(COMPANY, 'admin-1', 'return-1', editInput())).rejects.toThrow(
        'Solo se puede modificar una devolución pendiente de aprobación',
      );
      expect(txReturnItemRepo.delete).not.toHaveBeenCalled();
      expect(txReturnRepo.save).not.toHaveBeenCalled();
    });

    it('does not reveal a return of another company, and does not lock anything', async () => {
      const { service, txReturnRepo, sales } = createService();
      txReturnRepo.findOneBy.mockResolvedValue(null);

      await expect(service.edit(COMPANY, 'admin-1', 'return-9', editInput())).rejects.toThrow(
        NotFoundException,
      );
      expect(sales.lockCompleted).not.toHaveBeenCalled();
    });

    it('does not delete the old lines when the new ones ask for more than what is left', async () => {
      const { service, txReturnItemRepo, txReturnRepo } = createService();

      await expect(
        service.edit(
          COMPANY,
          'admin-1',
          'return-1',
          editInput({ items: [{ saleItemId: 'line-1', quantity: '5' }] }),
        ),
      ).rejects.toThrow(BadRequestException);
      expect(txReturnItemRepo.delete).not.toHaveBeenCalled();
      expect(txReturnRepo.save).not.toHaveBeenCalled();
    });

    it('does not repeat a line, before touching the database', async () => {
      const { service, dataSource } = createService();

      await expect(
        service.edit(
          COMPANY,
          'admin-1',
          'return-1',
          editInput({
            items: [
              { saleItemId: 'line-1', quantity: '1' },
              { saleItemId: 'line-1', quantity: '1' },
            ],
          }),
        ),
      ).rejects.toThrow('Una línea no puede repetirse en la devolución');
      expect(dataSource.transaction).not.toHaveBeenCalled();
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

    it('leaves who approved it and when, apart from who resolved it last', async () => {
      const { service } = createService();

      const approved = await service.approve(COMPANY, 'admin-1', 'return-1', {});

      expect(approved.approvedBy).toBe('admin-1');
      expect(approved.approvedAt).toBeInstanceOf(Date);
      expect(approved.approvedAt).toBe(approved.resolvedAt);
      expect(approved.cancelledBy).toBeNull();
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

    it('does not count as an approval: nobody is left as the one who approved it', async () => {
      const { service } = createService();

      const rejected = await service.reject(COMPANY, 'admin-1', 'return-1', {});

      expect(rejected.approvedBy).toBeNull();
      expect(rejected.approvedAt).toBeNull();
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

  // Aprobar y rechazar se pueden repetir con la misma clave sin resolver dos veces.
  const resolutions: ['approve' | 'reject', string][] = [
    ['approve', 'approveSaleReturn'],
    ['reject', 'rejectSaleReturn'],
  ];
  describe.each(resolutions)('%s with an idempotency key', (action, operation) => {
    const resolve = (service: SaleReturnService, notes: string, key?: string) =>
      service[action](COMPANY, 'admin-1', 'return-1', { notes }, key);
    const scopeInput = (notes: string) => ({ id: 'return-1', notes });

    it('claims the key in the same transaction, before resolving, and records the return', async () => {
      const { service, manager, dataSource, txReturnRepo } = createService();

      const resolved = await resolve(service, 'Ok', 'key-1');

      expect(dataSource.transaction).toHaveBeenCalledTimes(1);
      expect(manager.query).toHaveBeenNthCalledWith(
        1,
        expect.stringContaining('INSERT INTO "idempotency_keys"'),
        [COMPANY, 'admin-1', operation, 'key-1', fingerprintOf(scopeInput('Ok'))],
      );
      expect(manager.query).toHaveBeenNthCalledWith(
        2,
        expect.stringContaining('UPDATE "idempotency_keys"'),
        ['claim-1', 'sale_return', resolved.id],
      );
      expect(manager.query.mock.invocationCallOrder[0]).toBeLessThan(
        txReturnRepo.findOne.mock.invocationCallOrder[0],
      );
    });

    it('does not claim anything without a key', async () => {
      const { service, manager } = createService();

      await resolve(service, 'Ok');

      expect(manager.query).not.toHaveBeenCalled();
    });

    it('gives back the return that was already resolved when the same key comes again, instead of failing with "already resolved"', async () => {
      const mocks = createService();
      const { service, txReturnRepo, notifications } = mocks;
      keyAlreadyUsed(mocks, scopeInput('Ok'), { resourceId: 'return-1' });
      const alreadyResolved = saleReturn({
        status: action === 'approve' ? SaleReturnStatus.APPROVED : SaleReturnStatus.REJECTED,
      });
      txReturnRepo.findOneByOrFail.mockResolvedValue(alreadyResolved);

      const again = await resolve(service, 'Ok', 'key-1');

      expect(again).toBe(alreadyResolved);
      expect(txReturnRepo.findOneByOrFail).toHaveBeenCalledWith({ id: 'return-1' });
      // Ni se vuelve a bloquear ni a guardar, ni se avisa otra vez
      expect(txReturnRepo.findOne).not.toHaveBeenCalled();
      expect(txReturnRepo.save).not.toHaveBeenCalled();
      expect(notifications.notify).not.toHaveBeenCalled();
      expect(notifications.markEntityRead).not.toHaveBeenCalled();
      expect(notifications.signalChange).not.toHaveBeenCalled();
    });

    it('refuses the same key with other notes, and resolves nothing', async () => {
      const mocks = createService();
      const { service, txReturnRepo } = mocks;
      keyAlreadyUsed(mocks, scopeInput('Ok'), { resourceId: 'return-1' });

      await expect(resolve(service, 'Otra nota', 'key-1')).rejects.toThrow(ConflictException);

      expect(txReturnRepo.findOneByOrFail).not.toHaveBeenCalled();
      expect(txReturnRepo.save).not.toHaveBeenCalled();
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

    it('leaves who cancelled it and when', async () => {
      const { service, txReturnRepo } = createService();
      txReturnRepo.findOne.mockResolvedValue(saleReturn({ processedBy: 'cashier-1' }));

      const cancelled = await service.cancel(COMPANY, 'admin-1', 'return-1', true, {});

      expect(cancelled.cancelledBy).toBe('admin-1');
      expect(cancelled.cancelledAt).toBeInstanceOf(Date);
      expect(cancelled.cancelledAt).toBe(cancelled.resolvedAt);
    });

    it('keeps who approved it, and when, when an approved return is cancelled', async () => {
      const { service, txReturnRepo } = createService();
      const approvedAt = new Date('2026-09-24T10:00:00Z');
      txReturnRepo.findOne.mockResolvedValue(approvedReturn({ approvedBy: 'admin-2', approvedAt }));

      const cancelled = await service.cancel(COMPANY, 'cashier-1', 'return-1', false, {});

      expect(cancelled.approvedBy).toBe('admin-2');
      expect(cancelled.approvedAt).toBe(approvedAt);
      expect(cancelled.cancelledBy).toBe('cashier-1');
    });

    it('does not leave anybody as the one who approved a pending return that gets cancelled', async () => {
      const { service } = createService();

      const cancelled = await service.cancel(COMPANY, 'cashier-1', 'return-1', false, {});

      expect(cancelled.approvedBy).toBeNull();
      expect(cancelled.approvedAt).toBeNull();
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

    describe('in the store where the sale was made', () => {
      it('needs access to the store of the original sale', async () => {
        const { service, txReturnRepo, txAccessRepo, txRefundRepo, cashSessions } = createService();
        txReturnRepo.findOne.mockResolvedValue(approvedReturn());
        txAccessRepo.existsBy.mockResolvedValue(false);

        await expect(
          service.completeRefund(COMPANY, cashier, refundInput([cashRefund('100000')])),
        ).rejects.toThrow(ForbiddenException);

        expect(txAccessRepo.existsBy).toHaveBeenCalledWith({
          userId: 'cashier-1',
          locationId: 'store-1',
          status: RecordStatus.ACTIVE,
        });
        expect(cashSessions.lockOpen).not.toHaveBeenCalled();
        expect(txRefundRepo.save).not.toHaveBeenCalled();
        expect(txReturnRepo.save).not.toHaveBeenCalled();
      });

      it('needs it even when nothing comes out of the drawer, like a refund by transfer', async () => {
        const { service, txReturnRepo, txAccessRepo, txRefundRepo } = createService();
        txReturnRepo.findOne.mockResolvedValue(approvedReturn());
        txAccessRepo.existsBy.mockResolvedValue(false);

        await expect(
          service.completeRefund(
            COMPANY,
            cashier,
            refundInputWithoutShift([transferRefund('100000', 'TRF-1')]),
          ),
        ).rejects.toThrow(ForbiddenException);
        expect(txRefundRepo.save).not.toHaveBeenCalled();
      });

      it('checks the access before locking the shift', async () => {
        const { service, txReturnRepo, txAccessRepo, cashSessions } = createService();
        txReturnRepo.findOne.mockResolvedValue(approvedReturn());

        await service.completeRefund(COMPANY, cashier, refundInput([cashRefund('100000')]));

        expect(txAccessRepo.existsBy.mock.invocationCallOrder[0]).toBeLessThan(
          cashSessions.lockOpen.mock.invocationCallOrder[0],
        );
      });

      it('answers "not found" when the original sale of the return cannot be found', async () => {
        const { service, txReturnRepo, txSaleRepo, txRefundRepo } = createService();
        txReturnRepo.findOne.mockResolvedValue(approvedReturn());
        txSaleRepo.findOneBy.mockResolvedValue(null);

        await expect(
          service.completeRefund(COMPANY, cashier, refundInput([cashRefund('100000')])),
        ).rejects.toThrow('No se encontró la venta original de la devolución');
        expect(txRefundRepo.save).not.toHaveBeenCalled();
      });

      it('takes the cash out of a shift of the same store', async () => {
        const { service, txReturnRepo, cashSessions, txRefundRepo } = createService();
        txReturnRepo.findOne.mockResolvedValue(approvedReturn());
        cashSessions.lockOpen.mockResolvedValue({
          id: 'session-1',
          cashRegister: { storeId: 'store-1' },
        });

        const completed = await service.completeRefund(
          COMPANY,
          cashier,
          refundInput([cashRefund('100000')]),
        );

        expect(completed.status).toBe(SaleReturnStatus.COMPLETED);
        expect(txRefundRepo.create.mock.calls[0][0].cashSessionId).toBe('session-1');
      });

      it('does not take the cash out of a shift of another store', async () => {
        const { service, txReturnRepo, txRefundRepo, cashSessions } = createService();
        txReturnRepo.findOne.mockResolvedValue(approvedReturn());
        cashSessions.lockOpen.mockResolvedValue({
          id: 'session-2',
          cashRegister: { storeId: 'store-2' },
        });

        const attempt = service.completeRefund(COMPANY, cashier, {
          ...refundInput([cashRefund('100000')]),
          cashSessionId: 'session-2',
        });

        await expect(attempt).rejects.toThrow(ConflictException);
        await expect(attempt).rejects.toThrow(
          'El reembolso en efectivo tiene que salir de un turno de la tienda donde se hizo la venta',
        );
        // Ni se entrega el dinero ni se completa la devolución
        expect(txRefundRepo.save).not.toHaveBeenCalled();
        expect(txReturnRepo.save).not.toHaveBeenCalled();
      });
    });

    describe('with an idempotency key', () => {
      it('claims the key in the same transaction as the refund, gives the money once and records the return', async () => {
        const { service, txReturnRepo, txRefundRepo, manager, dataSource } = createService();
        txReturnRepo.findOne.mockResolvedValue(approvedReturn());
        const input = refundInput([cashRefund('100000')]);

        const completed = await service.completeRefund(COMPANY, cashier, input, 'key-1');

        expect(dataSource.transaction).toHaveBeenCalledTimes(1);
        expect(manager.query).toHaveBeenNthCalledWith(
          1,
          expect.stringContaining('INSERT INTO "idempotency_keys"'),
          [COMPANY, 'cashier-1', 'completeSaleReturnRefund', 'key-1', fingerprintOf(input)],
        );
        expect(manager.query).toHaveBeenNthCalledWith(
          2,
          expect.stringContaining('UPDATE "idempotency_keys"'),
          ['claim-1', 'sale_return', completed.id],
        );
        expect(txRefundRepo.save).toHaveBeenCalledTimes(1);
        expect(manager.query.mock.invocationCallOrder[0]).toBeLessThan(
          txRefundRepo.save.mock.invocationCallOrder[0],
        );
      });

      it('does not claim anything when the request comes without a key', async () => {
        const { service, txReturnRepo, manager } = createService();
        txReturnRepo.findOne.mockResolvedValue(approvedReturn());

        await service.completeRefund(COMPANY, cashier, refundInput([cashRefund('100000')]));

        expect(manager.query).not.toHaveBeenCalled();
      });

      it('does not give the money twice: the same key gives back the return that was already completed', async () => {
        const mocks = createService();
        const { service, txReturnRepo, txRefundRepo, txKeyRepo, cashSessions, txAccessRepo } = mocks;
        const input = refundInput([cashRefund('100000')]);
        keyAlreadyUsed(mocks, input, { resourceId: 'return-1' });
        const completedReturn = saleReturn({ status: SaleReturnStatus.COMPLETED });
        txReturnRepo.findOneByOrFail.mockResolvedValue(completedReturn);

        const again = await service.completeRefund(COMPANY, cashier, input, 'key-1');

        expect(again).toBe(completedReturn);
        expect(txKeyRepo.findOneBy).toHaveBeenCalledWith({
          companyId: COMPANY,
          userId: 'cashier-1',
          operation: 'completeSaleReturnRefund',
          key: 'key-1',
        });
        expect(txReturnRepo.findOneByOrFail).toHaveBeenCalledWith({ id: 'return-1' });
        // Nada se repite: ni el bloqueo, ni el turno, ni el reembolso, ni la devolución
        expect(txReturnRepo.findOne).not.toHaveBeenCalled();
        expect(txAccessRepo.existsBy).not.toHaveBeenCalled();
        expect(cashSessions.lockOpen).not.toHaveBeenCalled();
        expect(txRefundRepo.save).not.toHaveBeenCalled();
        expect(txReturnRepo.save).not.toHaveBeenCalled();
      });

      it('refuses the same key with other amounts, and gives no money', async () => {
        const mocks = createService();
        const { service, txReturnRepo, txRefundRepo } = mocks;
        keyAlreadyUsed(mocks, refundInput([cashRefund('100000')]), { resourceId: 'return-1' });

        await expect(
          service.completeRefund(COMPANY, cashier, refundInput([cashRefund('90000')]), 'key-1'),
        ).rejects.toThrow(ConflictException);

        expect(txReturnRepo.findOneByOrFail).not.toHaveBeenCalled();
        expect(txRefundRepo.save).not.toHaveBeenCalled();
        expect(txReturnRepo.save).not.toHaveBeenCalled();
      });
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
        withExchangeSale(txSaleRepo, { id: 'sale-2', returnCredit: d('80000') });

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
        withExchangeSale(txSaleRepo, { id: 'sale-2', returnCredit: d('80000') });

        await expect(
          service.completeRefund(COMPANY, cashier, refundInput([cashRefund('100000')])),
        ).rejects.toThrow('Los reembolsos suman 100000.00 y hay que devolver 20000.00');
        expect(txRefundRepo.save).not.toHaveBeenCalled();
      });

      it('fails when the sale of the exchange cannot be found', async () => {
        const { service, txReturnRepo, txSaleRepo } = createService();
        txReturnRepo.findOne.mockResolvedValue(partial());
        withExchangeSale(txSaleRepo, null);

        await expect(
          service.completeRefund(COMPANY, cashier, refundInput([cashRefund('20000')])),
        ).rejects.toThrow('No se encontró la venta del cambio');
      });

      it('gives the difference in the store of the ORIGINAL sale, not the one of the exchange', async () => {
        const { service, txReturnRepo, txSaleRepo, cashSessions } = createService();
        txReturnRepo.findOne.mockResolvedValue(partial());
        // La venta nueva se hizo en otra tienda; el reembolso sale de la tienda de la original
        withExchangeSale(txSaleRepo, { id: 'sale-2', storeId: 'store-2', returnCredit: d('80000') });
        cashSessions.lockOpen.mockResolvedValue({
          id: 'session-2',
          cashRegister: { storeId: 'store-2' },
        });

        await expect(
          service.completeRefund(COMPANY, cashier, refundInput([cashRefund('20000')])),
        ).rejects.toThrow(ConflictException);
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

  // Cada paso avisa a la otra parte, dentro de la misma transacción (canal Devoluciones).
  describe('notifications', () => {
    const aboutReturn = {
      companyId: COMPANY,
      entityType: NotificationEntityType.SALE_RETURN,
      entityId: 'return-1',
      locationId: 'store-1',
      reference: 'DEV-00018',
    };

    // El servicio ubica el aviso en la tienda de la venta original
    const withStore = (txSaleRepo: { findOneBy: ReturnType<typeof vi.fn> }) =>
      txSaleRepo.findOneBy.mockResolvedValue({ id: 'sale-1', storeId: 'store-1' });

    it('tells the administrators when a cashier registers a return', async () => {
      const { service, txSaleRepo, notifications } = createService();
      withStore(txSaleRepo);

      await service.request(
        COMPANY,
        cashierActor,
        requestInput([{ saleItemId: 'line-1', quantity: '1' }]),
      );

      expect(notifications.findUserIdsWithPermission).toHaveBeenCalledWith(
        expect.anything(),
        COMPANY,
        'sales.approve_return',
      );
      expect(notifications.notify).toHaveBeenCalledTimes(1);
      expect(notifications.notify).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({
          ...aboutReturn,
          type: NotificationType.RETURN_REQUESTED,
          recipientIds: ['admin-1', 'admin-2'],
          actorId: 'cashier-1',
        }),
      );
    });

    it('does not tell anyone when the return could not be registered', async () => {
      const { service, notifications } = createService();

      await expect(
        service.request(COMPANY, cashierActor, requestInput([{ saleItemId: 'line-9', quantity: '1' }])),
      ).rejects.toThrow(BadRequestException);

      expect(notifications.notify).not.toHaveBeenCalled();
    });

    it('tells whoever registered it when an administrator changes it, without clearing anything', async () => {
      const { service, txSaleRepo, notifications } = createService();
      withStore(txSaleRepo);

      await service.edit(COMPANY, 'admin-1', 'return-1', {
        items: [{ saleItemId: 'line-1', quantity: '1' }],
      });

      expect(notifications.notify).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({
          ...aboutReturn,
          type: NotificationType.RETURN_EDITED,
          recipientIds: ['cashier-1'],
          actorId: 'admin-1',
        }),
      );
      expect(notifications.markEntityRead).not.toHaveBeenCalled();
    });

    it('tells whoever registered it when an administrator approves, and clears the "new return" notices', async () => {
      const { service, txSaleRepo, notifications } = createService();
      withStore(txSaleRepo);

      await service.approve(COMPANY, 'admin-1', 'return-1', {});

      expect(notifications.notify).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({
          ...aboutReturn,
          type: NotificationType.RETURN_APPROVED,
          recipientIds: ['cashier-1'],
          actorId: 'admin-1',
        }),
      );
      expect(notifications.markEntityRead).toHaveBeenCalledWith(
        expect.anything(),
        NotificationEntityType.SALE_RETURN,
        'return-1',
        [NotificationType.RETURN_REQUESTED],
      );
    });

    it('tells whoever registered it when an administrator rejects, with the note, and clears the notices', async () => {
      const { service, txSaleRepo, notifications } = createService();
      withStore(txSaleRepo);

      await service.reject(COMPANY, 'admin-1', 'return-1', { notes: ' Zapato usado ' });

      expect(notifications.notify).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({
          ...aboutReturn,
          type: NotificationType.RETURN_REJECTED,
          recipientIds: ['cashier-1'],
          actorId: 'admin-1',
          notes: 'Zapato usado',
        }),
      );
      expect(notifications.markEntityRead).toHaveBeenCalledTimes(1);
    });

    it('does not tell anyone, nor clear anything, when the return was already resolved', async () => {
      const { service, txReturnRepo, notifications } = createService();
      txReturnRepo.findOne.mockResolvedValue(approvedReturn());

      await expect(service.approve(COMPANY, 'admin-1', 'return-1', {})).rejects.toThrow(
        ConflictException,
      );
      await expect(service.reject(COMPANY, 'admin-1', 'return-1', {})).rejects.toThrow(
        ConflictException,
      );

      expect(notifications.notify).not.toHaveBeenCalled();
      expect(notifications.markEntityRead).not.toHaveBeenCalled();
    });

    it('tells the administrators when the cashier who registered it cancels a pending return, and clears the notices', async () => {
      const { service, txSaleRepo, notifications } = createService();
      withStore(txSaleRepo);

      await service.cancel(COMPANY, 'cashier-1', 'return-1', false, { notes: 'El cliente se arrepintió' });

      expect(notifications.findUserIdsWithPermission).toHaveBeenCalledWith(
        expect.anything(),
        COMPANY,
        'sales.approve_return',
      );
      expect(notifications.notify).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({
          ...aboutReturn,
          type: NotificationType.RETURN_CANCELLED,
          recipientIds: ['admin-1', 'admin-2'],
          actorId: 'cashier-1',
          notes: 'El cliente se arrepintió',
        }),
      );
      expect(notifications.markEntityRead).toHaveBeenCalledTimes(1);
    });

    it('tells whoever registered it when an administrator cancels their return', async () => {
      const { service, notifications } = createService();

      await service.cancel(COMPANY, 'admin-1', 'return-1', true, {});

      expect(notifications.notify).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({
          type: NotificationType.RETURN_CANCELLED,
          recipientIds: ['cashier-1'],
          actorId: 'admin-1',
        }),
      );
    });

    it('does not clear the "new return" notices when it cancels a return that was already approved', async () => {
      const { service, txReturnRepo, notifications } = createService();
      txReturnRepo.findOne.mockResolvedValue(approvedReturn());

      await service.cancel(COMPANY, 'cashier-1', 'return-1', false, {});

      expect(notifications.notify).toHaveBeenCalledTimes(1);
      expect(notifications.markEntityRead).not.toHaveBeenCalled();
    });

    it('does not tell anyone when another cashier tries to cancel it', async () => {
      const { service, notifications } = createService();

      await expect(service.cancel(COMPANY, 'cashier-2', 'return-1', false, {})).rejects.toThrow(
        ForbiddenException,
      );

      expect(notifications.notify).not.toHaveBeenCalled();
      expect(notifications.markEntityRead).not.toHaveBeenCalled();
      expect(notifications.signalChange).not.toHaveBeenCalled();
    });

    it('keeps the notice without a store when the original sale cannot be found', async () => {
      const { service, txSaleRepo, notifications } = createService();
      txSaleRepo.findOneBy.mockResolvedValue(null);

      await service.approve(COMPANY, 'admin-1', 'return-1', {});

      expect(notifications.notify).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({ locationId: null }),
      );
    });
  });

  // Además del aviso, los demás administradores reciben una señal en vivo cuando una devolución
  // pendiente cambia o deja de estarlo, para que su lista de pendientes se ponga al día sola.
  describe('live signal to the other administrators', () => {
    const changedReturn = {
      companyId: COMPANY,
      channel: NotificationChannel.RETURNS,
      entityType: NotificationEntityType.SALE_RETURN,
      entityId: 'return-1',
      recipientIds: ['admin-1', 'admin-2'],
    };

    it('signals the administrators, except the one who approved', async () => {
      const { service, notifications } = createService();

      await service.approve(COMPANY, 'admin-1', 'return-1', {});

      expect(notifications.findUserIdsWithPermission).toHaveBeenCalledWith(
        expect.anything(),
        COMPANY,
        'sales.approve_return',
      );
      expect(notifications.signalChange).toHaveBeenCalledTimes(1);
      expect(notifications.signalChange).toHaveBeenCalledWith(expect.anything(), {
        ...changedReturn,
        exceptUserId: 'admin-1',
      });
    });

    it('signals them when a return is rejected', async () => {
      const { service, notifications } = createService();

      await service.reject(COMPANY, 'admin-2', 'return-1', {});

      expect(notifications.signalChange).toHaveBeenCalledWith(expect.anything(), {
        ...changedReturn,
        exceptUserId: 'admin-2',
      });
    });

    it('signals them when a pending return is cancelled, except whoever cancelled it', async () => {
      const { service, notifications } = createService();

      await service.cancel(COMPANY, 'cashier-1', 'return-1', false, {});

      expect(notifications.signalChange).toHaveBeenCalledWith(expect.anything(), {
        ...changedReturn,
        exceptUserId: 'cashier-1',
      });
    });

    it('signals them when an administrator changes a pending return, because what is returned changed', async () => {
      const { service, notifications } = createService();

      await service.edit(COMPANY, 'admin-1', 'return-1', {
        items: [{ saleItemId: 'line-1', quantity: '1' }],
      });

      expect(notifications.signalChange).toHaveBeenCalledTimes(1);
      expect(notifications.signalChange).toHaveBeenCalledWith(expect.anything(), {
        ...changedReturn,
        exceptUserId: 'admin-1',
      });
    });

    it('does not signal anything when the return was already approved: it was not in the pending list', async () => {
      const { service, txReturnRepo, notifications } = createService();
      txReturnRepo.findOne.mockResolvedValue(approvedReturn());

      await service.cancel(COMPANY, 'cashier-1', 'return-1', false, {});

      expect(notifications.signalChange).not.toHaveBeenCalled();
    });

    it('does not signal anything when a new return is registered', async () => {
      const { service, notifications } = createService();

      await service.request(
        COMPANY,
        cashierActor,
        requestInput([{ saleItemId: 'line-1', quantity: '1' }]),
      );

      // Ya reciben el aviso de la devolución nueva
      expect(notifications.signalChange).not.toHaveBeenCalled();
    });

    it('does not signal anything when the return was already resolved', async () => {
      const { service, txReturnRepo, notifications } = createService();
      txReturnRepo.findOne.mockResolvedValue(approvedReturn());

      await expect(service.approve(COMPANY, 'admin-1', 'return-1', {})).rejects.toThrow(
        ConflictException,
      );

      expect(notifications.signalChange).not.toHaveBeenCalled();
    });
  });
});
