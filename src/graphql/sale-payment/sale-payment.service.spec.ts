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
import { IdempotencyKey } from '../idempotency/entities/idempotency-key.entity.js';
import { NotificationChannel } from '../notification/entities/notification-channel.enum.js';
import { NotificationEntityType } from '../notification/entities/notification-entity-type.enum.js';
import { NotificationType } from '../notification/entities/notification-type.enum.js';
import { PaymentMethod } from '../payment-method/entities/payment-method.entity.js';
import { SaleItem } from '../sale/entities/sale-item.entity.js';
import { SaleStatus } from '../sale/entities/sale-status.enum.js';
import { Sale } from '../sale/entities/sale.entity.js';
import type { SaleActor } from '../sale/sale-actor.js';
import { StorePaymentMethod } from '../store-payment-method/entities/store-payment-method.entity.js';
import { UserLocationAccess } from '../user-location-access/entities/user-location-access.entity.js';
import { SalePayment } from './entities/sale-payment.entity.js';
import { SalePaymentService } from './sale-payment.service.js';

const COMPANY = 'company-1';
const d = (value: string) => new Decimal(value);
const cashier: CashActor = { userId: 'cashier-1', canViewAll: false, canManageShifts: false };
const otherCashier: CashActor = { userId: 'cashier-2', canViewAll: false, canManageShifts: false };
const admin: CashActor = { userId: 'admin-1', canViewAll: true, canManageShifts: true };
const cashierReader: SaleActor = { userId: 'cashier-1', canViewAll: false, canReadAny: false };

// Una venta en borrador tal como la entrega SaleService.lockAnyStatus: vale 100000, es del cajero
// 'cashier-1' (el del turno asignado), todavía no tiene consecutivo (se asigna al cobrar) y ya trae el
// turno en que se creó (SaleService.create), que es donde se cobra.
const draftSale = (overrides: Record<string, unknown> = {}) => ({
  id: 'sale-1',
  companyId: COMPANY,
  storeId: 'store-1',
  status: SaleStatus.DRAFT,
  total: d('100000'),
  saleNumber: null,
  cashierId: 'cashier-1',
  completedAt: null,
  cashSessionId: 'session-1',
  ...overrides,
});

// La misma venta ya cobrada, con su número
const completedSale = (overrides: Record<string, unknown> = {}) =>
  draftSale({
    status: SaleStatus.COMPLETED,
    saleNumber: 'VTA-000007',
    completedAt: new Date('2026-09-25T10:00:00Z'),
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
  payments,
});

// Un pago tal como quedó guardado en la base al cobrar
const stored = (
  paymentMethodId: string,
  amount: string,
  reference: string | null = null,
  receivedBy = 'cashier-1',
) => ({ paymentMethodId, amount: d(amount), reference, receivedBy });

function createService() {
  const paymentRepo = { find: vi.fn().mockResolvedValue([]) };
  const txPaymentRepo = {
    create: vi.fn((value: unknown) => value),
    save: vi.fn(async (value: unknown) => value),
    // Los pagos que la venta ya tiene guardados: solo se leen al reintentar el cobro de una ya cobrada
    find: vi.fn().mockResolvedValue([]),
  };
  const txRequestRepo = {
    // Las solicitudes pendientes de la venta que se retiran al cobrarla (ninguna por defecto)
    find: vi.fn().mockResolvedValue([]),
    update: vi.fn().mockResolvedValue(undefined),
  };
  const txItemRepo = { existsBy: vi.fn().mockResolvedValue(true) };
  const txMethodRepo = { find: vi.fn().mockResolvedValue([cashMethod, cardMethod]) };
  // Los medios que la tienda acepta (por defecto, los dos) y el acceso del usuario a la tienda
  const txStoreMethodRepo = {
    find: vi.fn().mockResolvedValue([{ paymentMethodId: 'method-cash' }, { paymentMethodId: 'method-card' }]),
  };
  const accessRepo = { existsBy: vi.fn().mockResolvedValue(true) };
  const txSaleRepo = {
    save: vi.fn(async (value: object) => ({ ...value })),
    // Lo que un reintento con la misma clave vuelve a cargar por su id
    findOneByOrFail: vi.fn(async ({ id }: { id: string }) => completedSale({ id })),
  };
  const sales = {
    findVisible: vi.fn().mockResolvedValue(draftSale()),
    lockAnyStatus: vi.fn().mockResolvedValue(draftSale()),
    recalculate: vi.fn(async (_manager: unknown, sale: object) => sale),
    // Le da a la venta su consecutivo si todavía no lo tiene, como el de verdad
    assignNumber: vi.fn(async (_manager: unknown, _companyId: string, sale: { saleNumber: string | null }) => {
      if (!sale.saleNumber) sale.saleNumber = 'VTA-000007';
    }),
  };
  const cashSessions = { lockOpen: vi.fn().mockResolvedValue(openSession()) };
  // Las devoluciones: solo se usan al cobrar la venta nueva de un cambio
  const returns = {
    lockForExchange: vi.fn(),
    applyExchange: vi.fn().mockResolvedValue(undefined),
  };
  // A quiénes se avisa cuando se retira una solicitud de descuento (los que aprueban descuentos)
  const notifications = {
    notify: vi.fn().mockResolvedValue(null),
    findUserIdsWithPermission: vi.fn().mockResolvedValue(['admin-1', 'admin-2']),
    markEntityRead: vi.fn().mockResolvedValue(0),
    signalChange: vi.fn(),
  };

  // Las claves de idempotencia que guardaría la base: reclamar una nueva la inserta; si ya estaba
  // (ON CONFLICT DO NOTHING) no inserta nada y el reintento la busca para devolver lo que se cobró.
  type ClaimScope = { companyId: string; userId: string; operation: string; key: string };
  const claims = new Map<string, { id: string; fingerprint: string; resourceId: string | null }>();
  const claimKey = (scope: ClaimScope) =>
    [scope.companyId, scope.userId, scope.operation, scope.key].join('|');
  const keyRepo = {
    findOneBy: vi.fn(async (where: ClaimScope) => claims.get(claimKey(where)) ?? null),
  };
  const query = vi.fn(async (sql: string, params: string[]) => {
    if (sql.includes('INSERT INTO "idempotency_keys"')) {
      const [companyId, userId, operation, key, fingerprint] = params;
      const claimId = claimKey({ companyId, userId, operation, key });
      if (claims.has(claimId)) return [];
      const claim = { id: `claim-${claims.size + 1}`, fingerprint, resourceId: null as string | null };
      claims.set(claimId, claim);
      return [{ id: claim.id }];
    }
    // UPDATE: anota qué recurso creó la operación
    const [claimId, , resourceId] = params;
    for (const claim of claims.values()) {
      if (claim.id === claimId) claim.resourceId = resourceId;
    }
    return [];
  });

  const manager = {
    query,
    getRepository: (entity: unknown) =>
      entity === SalePayment
        ? txPaymentRepo
        : entity === DiscountRequest
          ? txRequestRepo
          : entity === SaleItem
            ? txItemRepo
            : entity === PaymentMethod
              ? txMethodRepo
              : entity === StorePaymentMethod
                ? txStoreMethodRepo
                : entity === UserLocationAccess
                  ? accessRepo
                  : entity === IdempotencyKey
                    ? keyRepo
                    : entity === Sale
                      ? txSaleRepo
                      : undefined,
  };
  const dataSource = {
    transaction: vi.fn(async (fn: (manager: unknown) => unknown) => fn(manager)),
  };

  const service = new SalePaymentService(
    paymentRepo as never,
    dataSource as never,
    sales as never,
    cashSessions as never,
    returns as never,
    notifications as never,
  );
  return {
    service,
    paymentRepo,
    txPaymentRepo,
    txRequestRepo,
    txItemRepo,
    txMethodRepo,
    txStoreMethodRepo,
    accessRepo,
    txSaleRepo,
    sales,
    cashSessions,
    returns,
    notifications,
    keyRepo,
    query,
    manager,
    dataSource,
  };
}

// El orden en que se llamó por primera vez a un mock, para comprobar qué va antes de qué
const order = (mock: { mock: { invocationCallOrder: number[] } }) => mock.mock.invocationCallOrder[0];

describe('SalePaymentService', () => {
  describe('findAll', () => {
    it('lists the payments of a sale the actor can read, in the order they were registered', async () => {
      const { service, paymentRepo, sales } = createService();

      await service.findAll(COMPANY, cashierReader, 'sale-1');

      expect(sales.findVisible).toHaveBeenCalledWith(COMPANY, cashierReader, 'sale-1');
      expect(paymentRepo.find).toHaveBeenCalledWith({
        where: { saleId: 'sale-1' },
        order: { createdAt: 'ASC' },
      });
    });

    it('does not reveal the payments of a sale of another company', async () => {
      const { service, paymentRepo, sales } = createService();
      sales.findVisible.mockRejectedValue(new NotFoundException('Venta sale-9 no encontrada'));

      await expect(service.findAll(COMPANY, cashierReader, 'sale-9')).rejects.toThrow(NotFoundException);
      expect(paymentRepo.find).not.toHaveBeenCalled();
    });

    it('does not reveal the payments of a sale the actor cannot read, as if it did not exist', async () => {
      const { service, paymentRepo, sales } = createService();
      // SaleService.findVisible responde así a la venta de otro cajero
      sales.findVisible.mockRejectedValue(new NotFoundException('Venta sale-1 no encontrada'));

      await expect(service.findAll(COMPANY, cashierReader, 'sale-1')).rejects.toThrow(NotFoundException);
      expect(paymentRepo.find).not.toHaveBeenCalled();
    });
  });

  describe('complete', () => {
    it('saves the payment, completes the sale and ties it to the shift where it was paid', async () => {
      const { service, sales, txPaymentRepo, txSaleRepo } = createService();
      const sale = draftSale();
      sales.lockAnyStatus.mockResolvedValue(sale);

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
      sales.lockAnyStatus.mockResolvedValue(draftSale({ total: d('0.30') }));

      // 0.1 + 0.2 = 0.30000000000000004 con números normales
      await expect(
        service.complete(COMPANY, cashier, charge([cash('0.10'), cash('0.20')])),
      ).resolves.toMatchObject({ status: SaleStatus.COMPLETED });
    });

    it('locks the sale first and the shift after, always in that order', async () => {
      const { service, sales, cashSessions } = createService();

      await service.complete(COMPANY, cashier, charge([cash('100000')]));

      // La venta se bloquea sea cual sea su estado: así distingue un reintento de una cancelada
      expect(sales.lockAnyStatus).toHaveBeenCalledWith(expect.anything(), COMPANY, 'sale-1');
      expect(cashSessions.lockOpen).toHaveBeenCalledWith(
        expect.anything(),
        COMPANY,
        'session-1',
        cashier,
      );
      expect(order(sales.lockAnyStatus)).toBeLessThan(order(cashSessions.lockOpen));
    });

    it('charges what the lines add up to today, not what was saved', async () => {
      const { service, sales } = createService();
      const sale = draftSale();
      sales.lockAnyStatus.mockResolvedValue(sale);

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
      sales.lockAnyStatus.mockResolvedValue(draftSale({ total: d('0') }));

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

    it('cannot reach a sale of another company', async () => {
      const { service, sales, cashSessions, txPaymentRepo } = createService();
      sales.lockAnyStatus.mockRejectedValue(new NotFoundException('Venta sale-1 no encontrada'));

      await expect(service.complete(COMPANY, cashier, charge([cash('100000')]))).rejects.toThrow(
        NotFoundException,
      );
      expect(cashSessions.lockOpen).not.toHaveBeenCalled();
      expect(txPaymentRepo.save).not.toHaveBeenCalled();
    });

    it('does not charge a cancelled sale', async () => {
      const { service, sales, cashSessions, txPaymentRepo, txSaleRepo } = createService();
      sales.lockAnyStatus.mockResolvedValue(draftSale({ status: SaleStatus.CANCELLED }));

      await expect(service.complete(COMPANY, cashier, charge([cash('100000')]))).rejects.toThrow(
        'Solo se puede modificar una venta en borrador',
      );
      expect(cashSessions.lockOpen).not.toHaveBeenCalled();
      expect(txPaymentRepo.save).not.toHaveBeenCalled();
      expect(txSaleRepo.save).not.toHaveBeenCalled();
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
      sales.lockAnyStatus.mockResolvedValue(sale);

      await service.complete(COMPANY, cashier, charge([cash('100000')]));

      expect(sale.returnCredit.toFixed(2)).toBe('0.00');
      expect(returns.lockForExchange).not.toHaveBeenCalled();
      expect(returns.applyExchange).not.toHaveBeenCalled();
    });

    it('charges on the shift the sale was created in', async () => {
      const { service, sales, cashSessions } = createService();
      sales.lockAnyStatus.mockResolvedValue(draftSale({ cashSessionId: 'session-7' }));
      cashSessions.lockOpen.mockResolvedValue(openSession({ id: 'session-7' }));

      const completed = await service.complete(COMPANY, cashier, charge([cash('100000')]));

      expect(cashSessions.lockOpen).toHaveBeenCalledWith(expect.anything(), COMPANY, 'session-7', cashier);
      expect(completed.cashSessionId).toBe('session-7');
    });

    it('does not charge a sale that has no shift, and does not even try to lock one', async () => {
      const { service, sales, cashSessions, txPaymentRepo, txSaleRepo } = createService();
      sales.lockAnyStatus.mockResolvedValue(draftSale({ cashSessionId: null }));

      await expect(service.complete(COMPANY, cashier, charge([cash('100000')]))).rejects.toThrow(
        'La venta no tiene un turno asociado',
      );
      expect(cashSessions.lockOpen).not.toHaveBeenCalled();
      expect(txPaymentRepo.save).not.toHaveBeenCalled();
      expect(txSaleRepo.save).not.toHaveBeenCalled();
    });

    it('does not let a cashier charge in a store they have no access to', async () => {
      const { service, accessRepo, cashSessions, txPaymentRepo, txSaleRepo } = createService();
      accessRepo.existsBy.mockResolvedValue(false);

      await expect(service.complete(COMPANY, cashier, charge([cash('100000')]))).rejects.toThrow(
        ForbiddenException,
      );
      expect(accessRepo.existsBy).toHaveBeenCalledWith({
        userId: 'cashier-1',
        locationId: 'store-1',
        status: RecordStatus.ACTIVE,
      });
      expect(cashSessions.lockOpen).not.toHaveBeenCalled();
      expect(txPaymentRepo.save).not.toHaveBeenCalled();
      expect(txSaleRepo.save).not.toHaveBeenCalled();
    });

    it('looks up which of the payment methods the store accepts, only the active ones', async () => {
      const { service, txStoreMethodRepo } = createService();

      await service.complete(COMPANY, cashier, charge([cash('70000'), card('30000', 'A')]));

      expect(txStoreMethodRepo.find).toHaveBeenCalledWith({
        where: {
          storeId: 'store-1',
          paymentMethodId: In(['method-cash', 'method-card']),
          status: RecordStatus.ACTIVE,
        },
        select: { paymentMethodId: true },
      });
    });

    it('does not charge with a payment method the store does not accept', async () => {
      const { service, txStoreMethodRepo, txPaymentRepo, txSaleRepo } = createService();
      // La tienda solo acepta efectivo
      txStoreMethodRepo.find.mockResolvedValue([{ paymentMethodId: 'method-cash' }]);

      await expect(
        service.complete(COMPANY, cashier, charge([cash('70000'), card('30000', 'A')])),
      ).rejects.toThrow('Esta tienda no acepta Tarjeta: elige otro medio de pago');
      expect(txPaymentRepo.save).not.toHaveBeenCalled();
      expect(txSaleRepo.save).not.toHaveBeenCalled();
    });
  });

  // Solo cobra el cajero asignado a la venta: ni siquiera el administrador que abre y cierra turnos cobra
  // la venta de otro cajero, ni opera una tienda que no tiene asignada.
  describe('complete, who can charge', () => {
    it('does not let a cashier charge the sale of another cashier', async () => {
      const { service, sales, accessRepo, cashSessions, txRequestRepo, txPaymentRepo, txSaleRepo } =
        createService();
      // La venta es de 'cashier-1'; quien cobra es 'cashier-2'
      sales.lockAnyStatus.mockResolvedValue(draftSale());

      await expect(service.complete(COMPANY, otherCashier, charge([cash('100000')]))).rejects.toThrow(
        ForbiddenException,
      );
      await expect(service.complete(COMPANY, otherCashier, charge([cash('100000')]))).rejects.toThrow(
        'Solo el cajero de la venta puede cobrarla',
      );
      // Se niega antes de mirar el acceso a la tienda, el turno o la solicitud de descuento
      expect(accessRepo.existsBy).not.toHaveBeenCalled();
      expect(txRequestRepo.find).not.toHaveBeenCalled();
      expect(cashSessions.lockOpen).not.toHaveBeenCalled();
      expect(txPaymentRepo.save).not.toHaveBeenCalled();
      expect(txSaleRepo.save).not.toHaveBeenCalled();
    });

    it('does not let whoever opens and closes shifts charge it either, when they are not its cashier', async () => {
      const { service, sales, accessRepo, cashSessions, txPaymentRepo, txSaleRepo } = createService();
      sales.lockAnyStatus.mockResolvedValue(draftSale());

      await expect(service.complete(COMPANY, admin, charge([cash('100000')]))).rejects.toThrow(
        'Solo el cajero de la venta puede cobrarla',
      );
      expect(accessRepo.existsBy).not.toHaveBeenCalled();
      expect(cashSessions.lockOpen).not.toHaveBeenCalled();
      expect(txPaymentRepo.save).not.toHaveBeenCalled();
      expect(txSaleRepo.save).not.toHaveBeenCalled();
    });

    it('does not spend a consecutive number on a charge that was refused', async () => {
      const { service, sales } = createService();
      sales.lockAnyStatus.mockResolvedValue(draftSale());

      await expect(service.complete(COMPANY, admin, charge([cash('100000')]))).rejects.toThrow(
        ForbiddenException,
      );
      expect(sales.assignNumber).not.toHaveBeenCalled();
    });

    it('does not exempt whoever opens and closes shifts from having access to the store, even as the cashier of the sale', async () => {
      const { service, sales, accessRepo, cashSessions, txPaymentRepo } = createService();
      sales.lockAnyStatus.mockResolvedValue(draftSale({ cashierId: 'admin-1' }));
      accessRepo.existsBy.mockResolvedValue(false);

      await expect(service.complete(COMPANY, admin, charge([cash('100000')]))).rejects.toThrow(
        'No tienes acceso a esta tienda',
      );
      expect(accessRepo.existsBy).toHaveBeenCalledWith({
        userId: 'admin-1',
        locationId: 'store-1',
        status: RecordStatus.ACTIVE,
      });
      expect(cashSessions.lockOpen).not.toHaveBeenCalled();
      expect(txPaymentRepo.save).not.toHaveBeenCalled();
    });

    it('lets whoever opens and closes shifts charge their own sale, in a store they are assigned to', async () => {
      const { service, sales } = createService();
      sales.lockAnyStatus.mockResolvedValue(draftSale({ cashierId: 'admin-1' }));

      await expect(service.complete(COMPANY, admin, charge([cash('100000')]))).resolves.toMatchObject({
        status: SaleStatus.COMPLETED,
      });
    });
  });

  // El consecutivo (VTA-000123) se le da a la venta al cobrarla, no al crear el borrador.
  describe('complete, the number of the sale', () => {
    it('gives the sale its consecutive number when it is charged', async () => {
      const { service, sales, txSaleRepo } = createService();
      const sale = draftSale();
      sales.lockAnyStatus.mockResolvedValue(sale);

      const completed = await service.complete(COMPANY, cashier, charge([cash('100000')]));

      expect(sales.assignNumber).toHaveBeenCalledTimes(1);
      expect(sales.assignNumber).toHaveBeenCalledWith(expect.anything(), COMPANY, sale);
      expect(completed.saleNumber).toBe('VTA-000007');
      expect(txSaleRepo.save).toHaveBeenCalledWith(expect.objectContaining({ saleNumber: 'VTA-000007' }));
    });

    it('asks for it at the end, once the payments are saved and just before completing the sale', async () => {
      const { service, sales, txPaymentRepo, txSaleRepo } = createService();

      await service.complete(COMPANY, cashier, charge([cash('100000')]));

      expect(order(txPaymentRepo.save)).toBeLessThan(order(sales.assignNumber));
      expect(order(sales.assignNumber)).toBeLessThan(order(txSaleRepo.save));
    });

    it('asks for it inside the same transaction that charges', async () => {
      const { service, sales, manager } = createService();

      await service.complete(COMPANY, cashier, charge([cash('100000')]));

      expect(sales.assignNumber.mock.calls[0][0]).toBe(manager);
    });

    // Cada cobro que falla, con lo que hay que preparar para que falle
    type Mocks = ReturnType<typeof createService>;
    const failures: [string, (mocks: Mocks) => void, ReturnType<typeof charge>][] = [
      ['the payments do not add up to the total', () => undefined, charge([cash('99999.99')])],
      [
        'the store does not accept the payment method',
        (mocks) => {
          mocks.txStoreMethodRepo.find.mockResolvedValue([{ paymentMethodId: 'method-cash' }]);
        },
        charge([card('100000', 'A')]),
      ],
      [
        'the sale has no lines',
        (mocks) => {
          mocks.txItemRepo.existsBy.mockResolvedValue(false);
        },
        charge([cash('100000')]),
      ],
      [
        'the shift is not open',
        (mocks) => {
          mocks.cashSessions.lockOpen.mockRejectedValue(new ConflictException('El turno está cerrado'));
        },
        charge([cash('100000')]),
      ],
    ];

    it.each(failures)('does not spend a number when the charge fails because %s', async (_why, arrange, body) => {
      const mocks = createService();
      arrange(mocks);

      await expect(mocks.service.complete(COMPANY, cashier, body)).rejects.toThrow();
      expect(mocks.sales.assignNumber).not.toHaveBeenCalled();
    });
  });

  // Cobrar es idempotente por sí solo: si la venta ya se cobró con estos mismos pagos y por este mismo
  // cajero, lo que llega es un reintento (la respuesta se perdió, doble clic) y se devuelve la venta ya
  // cobrada en vez de rechazarlo con "solo se modifica un borrador". Sin clave de idempotencia.
  describe('complete, when the charge is repeated', () => {
    it('gives back the sale already charged with the same payments by the same cashier, without charging again', async () => {
      const { service, sales, txPaymentRepo, txSaleRepo, cashSessions, txRequestRepo } = createService();
      const done = completedSale();
      sales.lockAnyStatus.mockResolvedValue(done);
      txPaymentRepo.find.mockResolvedValue([stored('method-cash', '100000')]);

      const result = await service.complete(COMPANY, cashier, charge([cash('100000')]));

      expect(result).toBe(done);
      expect(txPaymentRepo.find).toHaveBeenCalledWith({ where: { saleId: 'sale-1' } });
      expect(txPaymentRepo.save).not.toHaveBeenCalled();
      expect(txSaleRepo.save).not.toHaveBeenCalled();
      expect(cashSessions.lockOpen).not.toHaveBeenCalled();
      expect(txRequestRepo.find).not.toHaveBeenCalled();
    });

    it('does not give the sale a second number: it keeps the one it got when it was charged', async () => {
      const { service, sales, txPaymentRepo } = createService();
      const done = completedSale();
      sales.lockAnyStatus.mockResolvedValue(done);
      txPaymentRepo.find.mockResolvedValue([stored('method-cash', '100000')]);

      const result = await service.complete(COMPANY, cashier, charge([cash('100000')]));

      expect(sales.assignNumber).not.toHaveBeenCalled();
      expect(result.saleNumber).toBe('VTA-000007');
    });

    it('recognises the same payments in any order, with the reference trimmed and the cents equal', async () => {
      const { service, sales, txPaymentRepo } = createService();
      sales.lockAnyStatus.mockResolvedValue(completedSale());
      txPaymentRepo.find.mockResolvedValue([
        stored('method-card', '30000.00', 'VOUCHER-1'),
        stored('method-cash', '70000.00'),
      ]);

      await expect(
        service.complete(COMPANY, cashier, charge([cash('70000'), card('30000', '  VOUCHER-1 ')])),
      ).resolves.toMatchObject({ id: 'sale-1', status: SaleStatus.COMPLETED });
    });

    it.each([
      ['another amount', [stored('method-cash', '100000')], [cash('99999.99')]],
      ['another payment method', [stored('method-cash', '100000')], [card('100000', 'A')]],
      ['another reference', [stored('method-card', '100000', 'A')], [card('100000', 'B')]],
      [
        'fewer payments',
        [stored('method-cash', '70000'), stored('method-card', '30000', 'A')],
        [cash('70000')],
      ],
      [
        'more payments',
        [stored('method-cash', '100000')],
        [cash('70000'), cash('30000')],
      ],
      [
        'the same number of payments but not the same ones',
        [stored('method-cash', '50000'), stored('method-card', '50000', 'A')],
        [cash('50000'), cash('50000')],
      ],
    ])(
      'does not take a completed sale for a retry when the payments are different: %s',
      async (_why, storedPayments, payments) => {
        const { service, sales, txPaymentRepo, txSaleRepo } = createService();
        sales.lockAnyStatus.mockResolvedValue(completedSale());
        txPaymentRepo.find.mockResolvedValue(storedPayments);

        await expect(service.complete(COMPANY, cashier, charge(payments))).rejects.toThrow(ConflictException);
        await expect(service.complete(COMPANY, cashier, charge(payments))).rejects.toThrow(
          'Solo se puede modificar una venta en borrador',
        );
        expect(txPaymentRepo.save).not.toHaveBeenCalled();
        expect(txSaleRepo.save).not.toHaveBeenCalled();
      },
    );

    it.each([
      ['another cashier', otherCashier],
      ['whoever opens and closes shifts, when they are not the cashier of the sale', admin],
    ])('does not take it for a retry when it comes from %s, so it does not reveal the payments', async (_who, actor) => {
      const { service, sales, txPaymentRepo, cashSessions } = createService();
      sales.lockAnyStatus.mockResolvedValue(completedSale());
      txPaymentRepo.find.mockResolvedValue([stored('method-cash', '100000')]);

      await expect(service.complete(COMPANY, actor, charge([cash('100000')]))).rejects.toThrow(ConflictException);
      // Ni siquiera se comparan los pagos
      expect(txPaymentRepo.find).not.toHaveBeenCalled();
      expect(cashSessions.lockOpen).not.toHaveBeenCalled();
    });

    it('does not take it for a retry when the stored payments were received by someone else', async () => {
      const { service, sales, txPaymentRepo } = createService();
      sales.lockAnyStatus.mockResolvedValue(completedSale());
      txPaymentRepo.find.mockResolvedValue([stored('method-cash', '100000', null, 'cashier-2')]);

      await expect(service.complete(COMPANY, cashier, charge([cash('100000')]))).rejects.toThrow(
        ConflictException,
      );
    });

    it('does not charge a cancelled sale again, and does not even compare its payments', async () => {
      const { service, sales, txPaymentRepo, txSaleRepo } = createService();
      sales.lockAnyStatus.mockResolvedValue(draftSale({ status: SaleStatus.CANCELLED }));

      await expect(service.complete(COMPANY, cashier, charge([cash('100000')]))).rejects.toThrow(
        ConflictException,
      );
      expect(txPaymentRepo.find).not.toHaveBeenCalled();
      expect(txSaleRepo.save).not.toHaveBeenCalled();
    });
  });

  describe('complete, with an idempotency key', () => {
    it('without a key, nothing is claimed', async () => {
      const { service, query } = createService();

      await service.complete(COMPANY, cashier, charge([cash('100000')]));

      expect(query).not.toHaveBeenCalled();
    });

    it('claims the key inside the same transaction as the charge and remembers the sale', async () => {
      const { service, query, dataSource } = createService();

      await service.complete(COMPANY, cashier, charge([cash('100000')]), 'key-pay');

      expect(dataSource.transaction).toHaveBeenCalledTimes(1);
      expect(query).toHaveBeenNthCalledWith(
        1,
        expect.stringContaining('INSERT INTO "idempotency_keys"'),
        [COMPANY, 'cashier-1', 'completeSale', 'key-pay', expect.any(String)],
      );
      expect(query).toHaveBeenNthCalledWith(
        2,
        expect.stringContaining('UPDATE "idempotency_keys"'),
        [expect.any(String), 'sale', 'sale-1'],
      );
    });

    it('a retry with the same key gives back the sale and charges nothing more', async () => {
      const { service, sales, txPaymentRepo, txSaleRepo } = createService();

      const first = await service.complete(COMPANY, cashier, charge([cash('100000')]), 'key-pay');
      const second = await service.complete(COMPANY, cashier, charge([cash('100000')]), 'key-pay');

      expect(second.id).toBe(first.id);
      expect(txSaleRepo.findOneByOrFail).toHaveBeenCalledWith({ id: 'sale-1' });
      expect(txPaymentRepo.save).toHaveBeenCalledTimes(1);
      // El reintento ni siquiera bloquea la venta ni pide otro número
      expect(sales.lockAnyStatus).toHaveBeenCalledTimes(1);
      expect(sales.assignNumber).toHaveBeenCalledTimes(1);
    });

    it('refuses the same key with other payments: it is not a retry, so it answers with a conflict', async () => {
      const { service, txPaymentRepo } = createService();
      await service.complete(COMPANY, cashier, charge([cash('100000')]), 'key-pay');

      await expect(
        service.complete(COMPANY, cashier, charge([cash('60000'), cash('40000')]), 'key-pay'),
      ).rejects.toThrow(ConflictException);
      await expect(
        service.complete(COMPANY, cashier, charge([cash('60000'), cash('40000')]), 'key-pay'),
      ).rejects.toThrow('otros datos');
      expect(txPaymentRepo.save).toHaveBeenCalledTimes(1);
    });

    it('the key belongs to the cashier who sent it: another user with the same key is not a retry', async () => {
      const { service, sales, txPaymentRepo } = createService();
      await service.complete(COMPANY, cashier, charge([cash('100000')]), 'key-pay');
      sales.lockAnyStatus.mockResolvedValue(draftSale({ cashierId: 'cashier-2' }));

      // 'cashier-2' cobra su propia venta con la misma clave: se cobra, no se devuelve la del otro
      await service.complete(COMPANY, otherCashier, charge([cash('100000')]), 'key-pay');

      expect(txPaymentRepo.save).toHaveBeenCalledTimes(2);
    });
  });

  // El cobro que retira sus solicitudes de descuento pendientes: se cobra al total de hoy y la solicitud
  // no queda colgada sobre una venta ya cerrada.
  describe('complete, discount requests of the sale', () => {
    const pendingRequest = { id: 'req-1', saleId: 'sale-1', status: DiscountRequestStatus.PENDING };

    it('charges a sale with a pending discount request instead of waiting for it: it withdraws the request and charges today’s total', async () => {
      const { service, txRequestRepo } = createService();
      txRequestRepo.find.mockResolvedValue([pendingRequest]);

      await service.complete(COMPANY, cashier, charge([cash('100000')]));

      // Solo las pendientes: una ya aprobada trae su descuento aplicado en el total que se cobra
      expect(txRequestRepo.find).toHaveBeenCalledWith({
        where: { saleId: In(['sale-1']), status: In([DiscountRequestStatus.PENDING]) },
      });
      expect(txRequestRepo.update).toHaveBeenCalledWith(
        { id: In(['req-1']) },
        expect.objectContaining({
          status: DiscountRequestStatus.CANCELLED,
          resolvedBy: cashier.userId,
          resolutionNotes: expect.stringContaining('Retirada automáticamente'),
        }),
      );
    });

    it('tells the approvers: the new-request notice is read and their pending list refreshes', async () => {
      const { service, txRequestRepo, notifications } = createService();
      txRequestRepo.find.mockResolvedValue([pendingRequest]);

      await service.complete(COMPANY, cashier, charge([cash('100000')]));

      expect(notifications.markEntityRead).toHaveBeenCalledWith(
        expect.anything(),
        NotificationEntityType.DISCOUNT_REQUEST,
        'req-1',
        [NotificationType.DISCOUNT_REQUESTED],
      );
      // A quien cobró no se le manda la señal: su pantalla ya se refresca con su propia operación
      expect(notifications.signalChange).toHaveBeenCalledWith(expect.anything(), {
        companyId: COMPANY,
        channel: NotificationChannel.DISCOUNTS,
        entityType: NotificationEntityType.DISCOUNT_REQUEST,
        entityId: 'req-1',
        recipientIds: ['admin-1', 'admin-2'],
        exceptUserId: 'cashier-1',
      });
    });

    it('with no pending request there is nothing to withdraw and nobody to tell', async () => {
      const { service, txRequestRepo, notifications } = createService();

      await service.complete(COMPANY, cashier, charge([cash('100000')]));

      expect(txRequestRepo.update).not.toHaveBeenCalled();
      expect(notifications.signalChange).not.toHaveBeenCalled();
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
      sales.lockAnyStatus.mockResolvedValue(sale);
      returns.lockForExchange.mockResolvedValue(returned('100000'));

      const completed = await service.complete(COMPANY, cashier, exchangeCharge([cash('30000')]));

      expect(returns.lockForExchange).toHaveBeenCalledWith(expect.anything(), COMPANY, 'return-1');
      expect(sale.returnCredit.toFixed(2)).toBe('100000.00');
      expect(txPaymentRepo.create).toHaveBeenCalledTimes(1);
      expect(txPaymentRepo.create.mock.calls[0][0].amount.toFixed(2)).toBe('30000.00');
      expect(completed.status).toBe(SaleStatus.COMPLETED);
    });

    it('needs no payment at all when the credit covers the whole exchange of the same value', async () => {
      const { service, sales, returns, txPaymentRepo, txStoreMethodRepo } = createService();
      const sale = draftSale({ total: d('100000') });
      sales.lockAnyStatus.mockResolvedValue(sale);
      returns.lockForExchange.mockResolvedValue(returned('100000'));

      const completed = await service.complete(COMPANY, cashier, exchangeCharge([]));

      expect(sale.returnCredit.toFixed(2)).toBe('100000.00');
      // Sin pagos no hay medio que la tienda tenga que aceptar
      expect(txStoreMethodRepo.find).not.toHaveBeenCalled();
      expect(txPaymentRepo.save).not.toHaveBeenCalled();
      expect(completed.status).toBe(SaleStatus.COMPLETED);
    });

    it('gives the number to an exchange that needs no payments too', async () => {
      const { service, sales, returns } = createService();
      sales.lockAnyStatus.mockResolvedValue(draftSale({ total: d('100000') }));
      returns.lockForExchange.mockResolvedValue(returned('100000'));

      const completed = await service.complete(COMPANY, cashier, exchangeCharge([]));

      expect(sales.assignNumber).toHaveBeenCalledTimes(1);
      expect(completed.saleNumber).toBe('VTA-000007');
    });

    it('only uses the credit the exchange is worth when it is cheaper, and the rest is left to refund', async () => {
      const { service, sales, returns } = createService();
      // Devuelve $100.000 y lleva uno de $80.000: el crédito usado es $80.000
      const sale = draftSale({ total: d('80000') });
      const saleReturn = returned('100000');
      sales.lockAnyStatus.mockResolvedValue(sale);
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
      sales.lockAnyStatus.mockResolvedValue(draftSale({ total: d('130000') }));
      returns.lockForExchange.mockResolvedValue(returned('100000'));

      await service.complete(COMPANY, cashier, exchangeCharge([cash('30000')]));

      expect(returns.applyExchange.mock.calls[0][3].toFixed(2)).toBe('100000.00');
    });

    it.each([[[]], [[cash('20000')]]])(
      'does not complete the exchange when the payments do not cover what is left after the credit (payments: %j)',
      async (payments) => {
        const { service, sales, returns, txPaymentRepo, txSaleRepo } = createService();
        sales.lockAnyStatus.mockResolvedValue(draftSale({ total: d('130000') }));
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
      sales.lockAnyStatus.mockResolvedValue(draftSale({ total: d('130000') }));
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
      sales.lockAnyStatus.mockResolvedValue(draftSale({ total: d('100000') }));
      returns.lockForExchange.mockResolvedValue(returned('100000'));

      await service.complete(COMPANY, cashier, exchangeCharge([]));

      expect(order(sales.lockAnyStatus)).toBeLessThan(order(returns.lockForExchange));
      expect(order(returns.lockForExchange)).toBeLessThan(order(cashSessions.lockOpen));
    });

    it('still asks for at least one payment when the sale is not an exchange', async () => {
      const { service, dataSource } = createService();

      await expect(service.complete(COMPANY, cashier, charge([]))).rejects.toThrow(
        BadRequestException,
      );
      expect(dataSource.transaction).not.toHaveBeenCalled();
    });

    it('takes the repeat of an exchange the credit paid in full for a retry, without applying it twice', async () => {
      const { service, sales, returns, txPaymentRepo, txSaleRepo } = createService();
      const done = completedSale();
      sales.lockAnyStatus.mockResolvedValue(done);
      // El cambio se pagó todo con crédito: no hay pagos guardados y la repetición tampoco los trae
      txPaymentRepo.find.mockResolvedValue([]);

      await expect(service.complete(COMPANY, cashier, exchangeCharge([]))).resolves.toBe(done);
      expect(returns.lockForExchange).not.toHaveBeenCalled();
      expect(returns.applyExchange).not.toHaveBeenCalled();
      expect(txSaleRepo.save).not.toHaveBeenCalled();
    });
  });
});
