import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { Decimal } from 'decimal.js';
import { In, QueryFailedError } from 'typeorm';
import { PermissionCode } from '../../common/enums/permission-code.enum.js';
import { RecordStatus } from '../../common/enums/record-status.enum.js';
import { CashMovementType } from '../cash-movement/entities/cash-movement-type.enum.js';
import { CashMovement } from '../cash-movement/entities/cash-movement.entity.js';
import { CashRegister } from '../cash-register/entities/cash-register.entity.js';
import { Company } from '../company/entities/company.entity.js';
import { DiscountRequestStatus } from '../discount-request/entities/discount-request-status.enum.js';
import { DiscountRequest } from '../discount-request/entities/discount-request.entity.js';
import { IdempotencyKey } from '../idempotency/entities/idempotency-key.entity.js';
import { fingerprintOf } from '../idempotency/idempotency.js';
import { LocationType } from '../location/entities/location-type.enum.js';
import { Location } from '../location/entities/location.entity.js';
import { NotificationChannel } from '../notification/entities/notification-channel.enum.js';
import { NotificationEntityType } from '../notification/entities/notification-entity-type.enum.js';
import { NotificationType } from '../notification/entities/notification-type.enum.js';
import { PaymentMethodType } from '../payment-method/entities/payment-method-type.enum.js';
import { RolePermission } from '../role-permission/entities/role-permission.entity.js';
import { SaleItem } from '../sale/entities/sale-item.entity.js';
import { SaleStatus } from '../sale/entities/sale-status.enum.js';
import { Sale } from '../sale/entities/sale.entity.js';
import { SalePayment } from '../sale-payment/entities/sale-payment.entity.js';
import { RefundPayment } from '../sale-return/entities/refund-payment.entity.js';
import { UserCompanyRole } from '../user-company-role/entities/user-company-role.entity.js';
import { UserLocationAccess } from '../user-location-access/entities/user-location-access.entity.js';
import { User } from '../user/entities/user.entity.js';
import type { CashActor } from './cash-actor.js';
import { CASH_CODE_PATTERN, CashCodeVerdict } from './cash-code.js';
import {
  CashSessionService,
  DEFAULT_SESSIONS_LIMIT,
  MAX_SESSIONS_LIMIT,
} from './cash-session.service.js';
import { CashSessionStatus } from './entities/cash-session-status.enum.js';
import { CashSession } from './entities/cash-session.entity.js';

const COMPANY = 'company-1';
const d = (value: string) => new Decimal(value);

const cashier: CashActor = { userId: 'cashier-1', canViewAll: false, canManageShifts: false };
const otherCashier: CashActor = { userId: 'cashier-2', canViewAll: false, canManageShifts: false };
const auditor: CashActor = { userId: 'auditor-1', canViewAll: true, canManageShifts: false };
const admin: CashActor = { userId: 'admin-1', canViewAll: true, canManageShifts: true };

// El error de la base de datos por violar un índice único, como lo entrega el driver de Postgres.
const uniqueViolation = () =>
  new QueryFailedError('INSERT', [], Object.assign(new Error('duplicate key'), { code: '23505' }));

// El error de Postgres cuando un SELECT ... FOR UPDATE NOWAIT encuentra la fila ya bloqueada.
const lockNotAvailable = () =>
  new QueryFailedError(
    'SELECT',
    [],
    Object.assign(new Error('could not obtain lock on row'), { code: '55P03' }),
  );

// Reclamar la clave de idempotencia (INSERT ... RETURNING) devuelve la fila reclamada: la clave era
// nueva. El UPDATE que la enlaza con lo que se creó no devuelve nada.
const claimKey = (sql: string) =>
  sql.includes('INSERT INTO "idempotency_keys"') ? [{ id: 'claim-1' }] : [];

const register = (overrides: Record<string, unknown> = {}) => ({
  id: 'register-1',
  storeId: 'store-1',
  status: RecordStatus.ACTIVE,
  ...overrides,
});

// Un turno abierto tal como lo entrega la base de datos, con su caja cargada: lo abrió el
// administrador para el cajero 'cashier-1'.
const openSession = (overrides: Record<string, unknown> = {}) => ({
  id: 'session-1',
  cashRegisterId: 'register-1',
  cashRegister: register(),
  openedBy: 'admin-1',
  cashierId: 'cashier-1',
  closedBy: null,
  openingAmount: d('200000'),
  expectedAmount: null,
  countedAmount: null,
  differenceAmount: null,
  status: CashSessionStatus.OPEN,
  movementCode: '123456',
  movementCodeFailures: 0,
  notes: null,
  ...overrides,
});

function createService() {
  const sessionRepo = { find: vi.fn().mockResolvedValue([]), findOne: vi.fn() };
  const txSessionRepo = {
    findOne: vi.fn(),
    // Con `cashRegister` en la condición es la comprobación de que el turno es de la empresa (al
    // cerrar: por defecto sí); sin él es "¿la caja / el cajero ya tiene un turno abierto?" (al abrir:
    // por defecto no).
    existsBy: vi.fn(async (where: Record<string, unknown>) => 'cashRegister' in where),
    // Lo que devuelve un reintento con la misma clave de idempotencia: el turno que ya se creó.
    findOneByOrFail: vi.fn(),
    create: vi.fn((value: unknown) => value),
    save: vi.fn(async (value: object) => ({ id: 'session-1', ...value })),
  };
  const txRegisterRepo = { findOne: vi.fn().mockResolvedValue(register()) };
  // El acceso de un usuario a una tienda: `existsBy` para el cajero de un turno, `find` para armar la
  // lista de candidatos.
  const accessRepo = { existsBy: vi.fn().mockResolvedValue(true), find: vi.fn().mockResolvedValue([]) };
  // La tienda de la caja (que tiene que estar en servicio) y la que se consulta al listar candidatos.
  const locationRepo = {
    findOneBy: vi.fn().mockResolvedValue({ id: 'store-1', name: 'Tienda centro', status: RecordStatus.ACTIVE }),
  };
  const paymentRepo = { find: vi.fn().mockResolvedValue([]) };
  const movementRepo = { find: vi.fn().mockResolvedValue([]) };
  const refundRepo = { find: vi.fn().mockResolvedValue([]) };
  // Las ventas en borrador del turno (que se borran al cerrarlo, y se cuentan en el resumen) y lo que
  // cuelga de ellas.
  const saleRepo = {
    find: vi.fn().mockResolvedValue([]),
    countBy: vi.fn().mockResolvedValue(0),
    delete: vi.fn().mockResolvedValue(undefined),
  };
  const saleItemRepo = { delete: vi.fn().mockResolvedValue(undefined) };
  // Las solicitudes de descuento de esas ventas: por defecto, ninguna.
  const discountRequestRepo = {
    find: vi.fn().mockResolvedValue([]),
    delete: vi.fn().mockResolvedValue(undefined),
  };
  // La cuenta del cajero: por defecto, activa.
  const userRepo = { existsBy: vi.fn().mockResolvedValue(true) };
  // Las claves de idempotencia ya reclamadas: por defecto, ninguna (la petición es nueva).
  const idempotencyRepo = { findOneBy: vi.fn().mockResolvedValue(null) };
  // Lo que lee loadCompanyAccess para saber si el cajero asignado puede cobrar: por defecto, es un
  // miembro con el rol Caja, que trae cash.register_payment, de una empresa activa.
  const membershipRepo = {
    find: vi
      .fn()
      .mockResolvedValue([
        { role: { id: 'role-cashier', code: 'CASHIER', status: RecordStatus.ACTIVE } },
      ]),
  };
  const rolePermissionRepo = {
    find: vi.fn().mockResolvedValue([
      { permission: { code: 'cash.register_payment', status: RecordStatus.ACTIVE } },
    ]),
  };
  const companyRepo = { existsBy: vi.fn().mockResolvedValue(true) };
  // Los avisos en vivo (y los de las solicitudes de descuento que se van con los borradores).
  const notifications = {
    signalChange: vi.fn(),
    findUserIdsWithPermission: vi.fn().mockResolvedValue([]),
    markEntityRead: vi.fn().mockResolvedValue(0),
  };
  const repositories = new Map<unknown, unknown>([
    [CashSession, txSessionRepo],
    [CashRegister, txRegisterRepo],
    [UserLocationAccess, accessRepo],
    [Location, locationRepo],
    [SalePayment, paymentRepo],
    [CashMovement, movementRepo],
    [RefundPayment, refundRepo],
    [Sale, saleRepo],
    [SaleItem, saleItemRepo],
    [DiscountRequest, discountRequestRepo],
    [User, userRepo],
    [IdempotencyKey, idempotencyRepo],
  ]);
  const manager = {
    getRepository: (entity: unknown) => repositories.get(entity),
    // Solo lo usa la idempotencia (reclamar la clave y enlazarla con lo creado).
    query: vi.fn(async (sql: string) => claimKey(sql)),
  };
  const dataSource = {
    manager,
    transaction: vi.fn(async (fn: (manager: unknown) => unknown) => fn(manager)),
    getRepository: (entity: unknown) =>
      entity === UserCompanyRole
        ? membershipRepo
        : entity === RolePermission
          ? rolePermissionRepo
          : entity === Company
            ? companyRepo
            : entity === Location
              ? locationRepo
              : entity === UserLocationAccess
                ? accessRepo
                : undefined,
  };

  const service = new CashSessionService(
    sessionRepo as never,
    dataSource as never,
    notifications as never,
  );
  return {
    service,
    sessionRepo,
    txSessionRepo,
    txRegisterRepo,
    accessRepo,
    locationRepo,
    paymentRepo,
    movementRepo,
    refundRepo,
    saleRepo,
    saleItemRepo,
    discountRequestRepo,
    userRepo,
    idempotencyRepo,
    membershipRepo,
    rolePermissionRepo,
    notifications,
    dataSource,
    manager,
  };
}

const cashPayment = (amount: string, saleId = 'sale-1') => ({
  saleId,
  amount: d(amount),
  paymentMethod: { type: PaymentMethodType.CASH },
});
const cardPayment = (amount: string, saleId = 'sale-1') => ({
  saleId,
  amount: d(amount),
  paymentMethod: { type: PaymentMethodType.CARD },
});
const movement = (amount: string, type: CashMovementType) => ({ amount: d(amount), type });

const opening = { cashRegisterId: 'register-1', cashierId: 'cashier-1' };

describe('CashSessionService', () => {
  describe('findAll', () => {
    it('shows a cashier only the shifts assigned to them, newest first, inside the company', async () => {
      const { service, sessionRepo } = createService();

      await service.findAll(COMPANY, cashier);

      expect(sessionRepo.find).toHaveBeenCalledWith({
        where: { cashRegister: { store: { companyId: COMPANY } }, cashierId: 'cashier-1' },
        order: { openedAt: 'DESC' },
        take: DEFAULT_SESSIONS_LIMIT,
        skip: 0,
      });
    });

    it('shows every shift to whoever can see them all', async () => {
      const { service, sessionRepo } = createService();

      await service.findAll(COMPANY, auditor);

      expect(sessionRepo.find).toHaveBeenCalledWith({
        where: { cashRegister: { store: { companyId: COMPANY } } },
        order: { openedAt: 'DESC' },
        take: DEFAULT_SESSIONS_LIMIT,
        skip: 0,
      });
    });

    it('can narrow the list down by status and register', async () => {
      const { service, sessionRepo } = createService();

      await service.findAll(COMPANY, admin, {
        status: CashSessionStatus.OPEN,
        cashRegisterId: 'register-1',
      });

      expect(sessionRepo.find).toHaveBeenCalledWith({
        where: {
          cashRegister: { store: { companyId: COMPANY } },
          status: CashSessionStatus.OPEN,
          cashRegisterId: 'register-1',
        },
        order: { openedAt: 'DESC' },
        take: DEFAULT_SESSIONS_LIMIT,
        skip: 0,
      });
    });

    it('keeps the history to the 300 most recent shifts by default, and to 1000 at most', () => {
      expect(DEFAULT_SESSIONS_LIMIT).toBe(300);
      expect(MAX_SESSIONS_LIMIT).toBe(1000);
    });

    it('pages through the history with the limit and the offset', async () => {
      const { service, sessionRepo } = createService();

      await service.findAll(COMPANY, admin, { limit: 50, offset: 100 });

      expect(sessionRepo.find).toHaveBeenCalledWith(
        expect.objectContaining({ order: { openedAt: 'DESC' }, take: 50, skip: 100 }),
      );
    });

    it('never returns more than the maximum, however much is asked for, nor less than one', async () => {
      const { service, sessionRepo } = createService();

      await service.findAll(COMPANY, admin, { limit: 50_000 });
      await service.findAll(COMPANY, admin, { limit: 0 });
      await service.findAll(COMPANY, admin, { limit: -10 });

      const takes = sessionRepo.find.mock.calls.map(([options]) => options.take);
      expect(takes).toEqual([MAX_SESSIONS_LIMIT, 1, 1]);
    });

    it('never skips a negative number of shifts', async () => {
      const { service, sessionRepo } = createService();

      await service.findAll(COMPANY, admin, { offset: -5 });

      expect(sessionRepo.find).toHaveBeenCalledWith(expect.objectContaining({ skip: 0 }));
    });
  });

  describe('findOne', () => {
    it('looks the shift up through its register and store, and only among the ones assigned to the cashier', async () => {
      const { service, sessionRepo } = createService();
      sessionRepo.findOne.mockResolvedValue(null);

      await expect(service.findOne(COMPANY, cashier, 'session-9')).rejects.toThrow(
        NotFoundException,
      );
      expect(sessionRepo.findOne).toHaveBeenCalledWith({
        where: {
          id: 'session-9',
          cashRegister: { store: { companyId: COMPANY } },
          cashierId: 'cashier-1',
        },
      });
    });

    it('does not limit it to the cashier for whoever can see every shift', async () => {
      const { service, sessionRepo } = createService();
      sessionRepo.findOne.mockResolvedValue(openSession());

      await service.findOne(COMPANY, auditor, 'session-1');

      expect(sessionRepo.findOne).toHaveBeenCalledWith({
        where: { id: 'session-1', cashRegister: { store: { companyId: COMPANY } } },
      });
    });
  });

  describe('findMyOpen', () => {
    it('finds the open shift assigned to the user inside the company', async () => {
      const { service, sessionRepo } = createService();

      await service.findMyOpen(COMPANY, 'cashier-1');

      expect(sessionRepo.findOne).toHaveBeenCalledWith({
        where: {
          cashierId: 'cashier-1',
          status: CashSessionStatus.OPEN,
          cashRegister: { store: { companyId: COMPANY } },
        },
      });
    });
  });

  describe('summary', () => {
    it('adds up what has happened in the shift and the cash that should be in the register', async () => {
      const { service, sessionRepo, paymentRepo, movementRepo } = createService();
      sessionRepo.findOne.mockResolvedValue(openSession());
      paymentRepo.find.mockResolvedValue([
        cashPayment('80000', 'sale-1'),
        cardPayment('20000', 'sale-1'),
        cashPayment('50000', 'sale-2'),
      ]);
      movementRepo.find.mockResolvedValue([movement('10000', CashMovementType.CASH_OUT)]);

      const summary = await service.summary(COMPANY, cashier, 'session-1');

      expect(paymentRepo.find).toHaveBeenCalledWith({
        where: { sale: { cashSessionId: 'session-1' } },
        relations: { paymentMethod: true },
      });
      expect(movementRepo.find).toHaveBeenCalledWith({ where: { cashSessionId: 'session-1' } });
      expect(summary.cashSessionId).toBe('session-1');
      expect(summary.salesCount).toBe(2);
      expect(summary.cashSales.toFixed(2)).toBe('130000.00');
      expect(summary.cardSales.toFixed(2)).toBe('20000.00');
      expect(summary.cashOut.toFixed(2)).toBe('10000.00');
      // 200000 + 130000 − 10000
      expect(summary.expectedCash.toFixed(2)).toBe('320000.00');
    });

    it('tells how many draft sales are left in the shift, the ones closing it would delete', async () => {
      const { service, sessionRepo, saleRepo } = createService();
      sessionRepo.findOne.mockResolvedValue(openSession());
      saleRepo.countBy.mockResolvedValue(3);

      const summary = await service.summary(COMPANY, cashier, 'session-1');

      // Solo cuentan los borradores de ESTE turno: una venta cobrada o anulada ya no se borra.
      expect(saleRepo.countBy).toHaveBeenCalledWith({
        cashSessionId: 'session-1',
        status: SaleStatus.DRAFT,
      });
      expect(summary.draftSalesCount).toBe(3);
    });

    it('reports no drafts when the shift has none', async () => {
      const { service, sessionRepo } = createService();
      sessionRepo.findOne.mockResolvedValue(openSession());

      const summary = await service.summary(COMPANY, cashier, 'session-1');

      expect(summary.draftSalesCount).toBe(0);
    });

    it('does not add up a shift the user cannot see', async () => {
      const { service, sessionRepo, paymentRepo } = createService();
      sessionRepo.findOne.mockResolvedValue(null);

      await expect(service.summary(COMPANY, cashier, 'session-9')).rejects.toThrow(
        NotFoundException,
      );
      expect(paymentRepo.find).not.toHaveBeenCalled();
    });

    it('takes the cash refunds of returns out of the expected cash, and not the ones by transfer', async () => {
      const { service, sessionRepo, paymentRepo, movementRepo, refundRepo } = createService();
      sessionRepo.findOne.mockResolvedValue(openSession());
      paymentRepo.find.mockResolvedValue([cashPayment('800000')]);
      movementRepo.find.mockResolvedValue([movement('50000', CashMovementType.CASH_OUT)]);
      refundRepo.find.mockResolvedValue([
        { amount: d('100000'), paymentMethod: { type: PaymentMethodType.CASH } },
        { amount: d('30000'), paymentMethod: { type: PaymentMethodType.TRANSFER } },
      ]);

      const summary = await service.summary(COMPANY, cashier, 'session-1');

      expect(refundRepo.find).toHaveBeenCalledWith({
        where: { cashSessionId: 'session-1' },
        relations: { paymentMethod: true },
      });
      expect(summary.cashRefunds.toFixed(2)).toBe('100000.00');
      // El ejemplo del diseño: 200.000 + 800.000 − 100.000 de devoluciones − 50.000 de otras salidas
      expect(summary.expectedCash.toFixed(2)).toBe('850000.00');
    });
  });

  describe('findCashierCandidates', () => {
    const person = (id: string) => ({ id, firstName: id, lastName: 'Apellido', status: RecordStatus.ACTIVE });

    // Cada usuario tiene su propio rol ('role-<id>'); solo 'role-cashier-1' y 'role-cashier-2' traen el
    // permiso de cobrar. Es lo que `loadCompanyAccess` lee para saber qué puede hacer cada uno.
    function withRoles(created: ReturnType<typeof createService>, members: string[]) {
      created.membershipRepo.find.mockImplementation(async ({ where }: { where: { userId: string } }) =>
        members.includes(where.userId)
          ? [{ role: { id: `role-${where.userId}`, code: 'ROLE', status: RecordStatus.ACTIVE } }]
          : [],
      );
      created.rolePermissionRepo.find.mockImplementation(
        async ({ where }: { where: { roleId: { value: string[] } } }) => {
          const canCharge = where.roleId.value.some((roleId) => roleId.startsWith('role-cashier'));
          return [{ permission: { code: canCharge ? 'cash.register_payment' : 'sales.view', status: RecordStatus.ACTIVE } }];
        },
      );
    }

    it('offers only who has access to the store AND a role that lets them charge', async () => {
      const created = createService();
      created.accessRepo.find.mockResolvedValue([
        { user: person('cashier-1') },
        { user: person('seller-1') },
        { user: person('cashier-2') },
      ]);
      withRoles(created, ['cashier-1', 'seller-1', 'cashier-2']);

      const candidates = await created.service.findCashierCandidates(COMPANY, 'store-1');

      // El vendedor tiene acceso a la tienda pero su rol no cobra: no se ofrece.
      expect(candidates.map((user) => user.id)).toEqual(['cashier-1', 'cashier-2']);
    });

    it('is the same rule `open` applies: whoever is offered is not refused for lacking the permission', async () => {
      const created = createService();
      created.accessRepo.find.mockResolvedValue([{ user: person('seller-1') }]);
      withRoles(created, ['seller-1']);

      expect(await created.service.findCashierCandidates(COMPANY, 'store-1')).toEqual([]);
      await expect(
        created.service.open(COMPANY, 'admin-1', { ...opening, cashierId: 'seller-1' }),
      ).rejects.toThrow(BadRequestException);
    });

    it('does not offer someone who is not a member of the company any more', async () => {
      const created = createService();
      created.accessRepo.find.mockResolvedValue([{ user: person('cashier-1') }]);
      withRoles(created, []);

      expect(await created.service.findCashierCandidates(COMPANY, 'store-1')).toEqual([]);
    });

    it('only looks at active users with active access to that store', async () => {
      const created = createService();

      await created.service.findCashierCandidates(COMPANY, 'store-1');

      expect(created.accessRepo.find).toHaveBeenCalledWith({
        where: { locationId: 'store-1', status: RecordStatus.ACTIVE, user: { status: RecordStatus.ACTIVE } },
        relations: { user: true },
      });
    });

    it('checks the store belongs to the company and is a store, before looking at anyone', async () => {
      const created = createService();
      created.locationRepo.findOneBy.mockResolvedValue(null);

      await expect(created.service.findCashierCandidates(COMPANY, 'store-9')).rejects.toThrow(NotFoundException);
      expect(created.locationRepo.findOneBy).toHaveBeenCalledWith({
        id: 'store-9',
        companyId: COMPANY,
        type: LocationType.STORE,
      });
      expect(created.accessRepo.find).not.toHaveBeenCalled();
    });

    it('a store nobody has access to has no candidates', async () => {
      const { service } = createService();

      expect(await service.findCashierCandidates(COMPANY, 'store-1')).toEqual([]);
    });
  });

  describe('open', () => {
    it('opens the shift of an active register for the cashier, with the opening amount and a new code', async () => {
      const { service, txRegisterRepo, txSessionRepo } = createService();

      const opened = await service.open(COMPANY, 'admin-1', { ...opening, openingAmount: '200000' });

      expect(txRegisterRepo.findOne).toHaveBeenNthCalledWith(1, {
        where: { id: 'register-1', store: { companyId: COMPANY } },
      });
      const created = txSessionRepo.create.mock.calls[0][0];
      expect(created).toMatchObject({
        cashRegisterId: 'register-1',
        openedBy: 'admin-1',
        cashierId: 'cashier-1',
        status: CashSessionStatus.OPEN,
        movementCodeFailures: 0,
      });
      expect(created.openingAmount.toFixed(2)).toBe('200000.00');
      expect(created.openedAt).toBeInstanceOf(Date);
      // El código nace con el turno y se le devuelve a quien lo abrió
      expect(created.movementCode).toMatch(CASH_CODE_PATTERN);
      expect(opened.code).toBe(created.movementCode);
      expect(opened.session.id).toBe('session-1');
    });

    it('starts from zero when no opening amount is given', async () => {
      const { service, txSessionRepo } = createService();

      await service.open(COMPANY, 'admin-1', opening);

      expect(txSessionRepo.create.mock.calls[0][0].openingAmount.toFixed(2)).toBe('0.00');
    });

    it('locks the register and reads it again before opening, so a deactivation in between is seen', async () => {
      const { service, txRegisterRepo } = createService();

      await service.open(COMPANY, 'admin-1', opening);

      expect(txRegisterRepo.findOne).toHaveBeenNthCalledWith(2, {
        where: { id: 'register-1' },
        lock: { mode: 'pessimistic_write' },
      });
    });

    it('looks the cashier up as a member of the company, before opening any transaction', async () => {
      const { service, membershipRepo, dataSource } = createService();
      membershipRepo.find.mockResolvedValue([]);

      await expect(service.open(COMPANY, 'admin-1', opening)).rejects.toThrow(NotFoundException);
      expect(membershipRepo.find).toHaveBeenCalledWith({
        where: { userId: 'cashier-1', companyId: COMPANY, status: RecordStatus.ACTIVE },
        relations: { role: true },
      });
      expect(dataSource.transaction).not.toHaveBeenCalled();
    });

    it('does not assign a user who cannot charge as the cashier of the shift', async () => {
      const { service, rolePermissionRepo, dataSource } = createService();
      rolePermissionRepo.find.mockResolvedValue([
        { permission: { code: 'sales.view', status: RecordStatus.ACTIVE } },
      ]);

      await expect(service.open(COMPANY, 'admin-1', opening)).rejects.toThrow(BadRequestException);
      expect(dataSource.transaction).not.toHaveBeenCalled();
    });

    it('does not assign a cashier who has no access to the store of the register', async () => {
      const { service, accessRepo, txSessionRepo } = createService();
      accessRepo.existsBy.mockResolvedValue(false);

      await expect(service.open(COMPANY, 'admin-1', opening)).rejects.toThrow(BadRequestException);
      expect(txSessionRepo.save).not.toHaveBeenCalled();
    });

    it('checks the access of the cashier, and not the one of the administrator who opens the shift', async () => {
      const { service, accessRepo } = createService();

      await service.open(COMPANY, 'admin-1', opening);

      expect(accessRepo.existsBy).toHaveBeenCalledTimes(1);
      expect(accessRepo.existsBy).toHaveBeenCalledWith({
        userId: 'cashier-1',
        locationId: 'store-1',
        status: RecordStatus.ACTIVE,
      });
    });

    it('checks the access of the cashier with the register already locked, so an access being removed at the same time is seen', async () => {
      const { service, txRegisterRepo, accessRepo } = createService();

      await service.open(COMPANY, 'admin-1', opening);

      // La segunda lectura de la caja es la que la bloquea
      expect(txRegisterRepo.findOne.mock.invocationCallOrder[1]).toBeLessThan(
        accessRepo.existsBy.mock.invocationCallOrder[0],
      );
    });

    it('does not open a register of another company', async () => {
      const { service, txRegisterRepo, txSessionRepo } = createService();
      txRegisterRepo.findOne.mockResolvedValue(null);

      await expect(
        service.open(COMPANY, 'admin-1', { ...opening, cashRegisterId: 'register-9' }),
      ).rejects.toThrow(NotFoundException);
      expect(txSessionRepo.save).not.toHaveBeenCalled();
    });

    it('does not open a register that was deactivated', async () => {
      const { service, txRegisterRepo, txSessionRepo } = createService();
      txRegisterRepo.findOne
        .mockResolvedValueOnce(register())
        .mockResolvedValueOnce(register({ status: RecordStatus.INACTIVE }));

      await expect(service.open(COMPANY, 'admin-1', opening)).rejects.toThrow(ConflictException);
      expect(txSessionRepo.save).not.toHaveBeenCalled();
    });

    it('does not open a register whose store was deactivated, even if the register itself is active', async () => {
      const { service, locationRepo, txSessionRepo } = createService();
      locationRepo.findOneBy.mockResolvedValue({ id: 'store-1', status: RecordStatus.INACTIVE });

      await expect(service.open(COMPANY, 'admin-1', opening)).rejects.toThrow(
        'La tienda de esta caja está desactivada: no se puede abrir un turno en ella',
      );
      expect(txSessionRepo.save).not.toHaveBeenCalled();
    });

    it('allows only one open shift per register', async () => {
      const { service, txSessionRepo } = createService();
      txSessionRepo.existsBy.mockResolvedValueOnce(true);

      await expect(service.open(COMPANY, 'admin-1', opening)).rejects.toThrow(ConflictException);
      expect(txSessionRepo.existsBy).toHaveBeenCalledWith({
        cashRegisterId: 'register-1',
        status: CashSessionStatus.OPEN,
      });
      expect(txSessionRepo.save).not.toHaveBeenCalled();
    });

    it('allows only one open shift per cashier: one cashier per register, not two registers at once', async () => {
      const { service, txSessionRepo } = createService();
      txSessionRepo.existsBy.mockResolvedValueOnce(false).mockResolvedValueOnce(true);

      const attempt = service.open(COMPANY, 'admin-1', opening);

      await expect(attempt).rejects.toThrow(ConflictException);
      await expect(attempt).rejects.toThrow('Ese cajero ya tiene un turno abierto en otra caja');
      expect(txSessionRepo.existsBy).toHaveBeenLastCalledWith({
        cashierId: 'cashier-1',
        status: CashSessionStatus.OPEN,
      });
      expect(txSessionRepo.save).not.toHaveBeenCalled();
    });

    it('does not assign an account that is no longer active, even if it still has its roles', async () => {
      const { service, userRepo, txSessionRepo } = createService();
      userRepo.existsBy.mockResolvedValue(false);

      await expect(service.open(COMPANY, 'admin-1', opening)).rejects.toThrow(BadRequestException);
      expect(userRepo.existsBy).toHaveBeenCalledWith({
        id: 'cashier-1',
        status: RecordStatus.ACTIVE,
      });
      expect(txSessionRepo.save).not.toHaveBeenCalled();
    });

    it('signals the assigned cashier live, without creating a notice, once the shift is opened', async () => {
      const { service, notifications, manager } = createService();

      await service.open(COMPANY, 'admin-1', opening);

      // Al administrador que abrió no se le avisa (su pantalla ya se refresca sola); al cajero, sí.
      expect(notifications.signalChange).toHaveBeenCalledTimes(1);
      expect(notifications.signalChange).toHaveBeenCalledWith(manager, {
        companyId: COMPANY,
        channel: NotificationChannel.CASH,
        entityType: NotificationEntityType.CASH_SESSION,
        entityId: 'session-1',
        recipientIds: ['cashier-1'],
        exceptUserId: 'admin-1',
      });
    });

    it('signals nobody when the shift could not be opened', async () => {
      const { service, txSessionRepo, notifications } = createService();
      txSessionRepo.existsBy.mockResolvedValueOnce(true);

      await expect(service.open(COMPANY, 'admin-1', opening)).rejects.toThrow(ConflictException);
      expect(notifications.signalChange).not.toHaveBeenCalled();
    });

    it('lets the administrator open as many registers as there are cashiers', async () => {
      const { service, txSessionRepo } = createService();

      // Ninguna comprobación mira quién abre: solo la caja y el cajero
      await service.open(COMPANY, 'admin-1', opening);
      await service.open(COMPANY, 'admin-1', { ...opening, cashRegisterId: 'register-2', cashierId: 'cashier-2' });

      expect(txSessionRepo.existsBy).not.toHaveBeenCalledWith(
        expect.objectContaining({ openedBy: expect.anything() }),
      );
      expect(txSessionRepo.save).toHaveBeenCalledTimes(2);
    });

    it('turns the unique index error of two openings at once into a conflict', async () => {
      const { service, txSessionRepo } = createService();
      txSessionRepo.save.mockRejectedValue(uniqueViolation());

      await expect(service.open(COMPANY, 'admin-1', opening)).rejects.toThrow(ConflictException);
    });

    describe('with an idempotency key', () => {
      const input = { ...opening, openingAmount: '200000' };

      it('claims the key in the same transaction as the opening, before creating the shift, and links it to the new shift', async () => {
        const { service, manager, dataSource, txSessionRepo } = createService();

        await service.open(COMPANY, 'admin-1', input, 'key-1');

        expect(dataSource.transaction).toHaveBeenCalledTimes(1);
        expect(manager.query).toHaveBeenNthCalledWith(
          1,
          expect.stringContaining('INSERT INTO "idempotency_keys"'),
          [COMPANY, 'admin-1', 'openCashSession', 'key-1', fingerprintOf(input)],
        );
        expect(manager.query).toHaveBeenNthCalledWith(
          2,
          expect.stringContaining('UPDATE "idempotency_keys"'),
          ['claim-1', 'cash_session', 'session-1'],
        );
        expect(manager.query.mock.invocationCallOrder[0]).toBeLessThan(
          txSessionRepo.save.mock.invocationCallOrder[0],
        );
      });

      it('claims nothing without a key: it works as before', async () => {
        const { service, manager, idempotencyRepo, txSessionRepo } = createService();

        await service.open(COMPANY, 'admin-1', input);

        expect(manager.query).not.toHaveBeenCalled();
        expect(idempotencyRepo.findOneBy).not.toHaveBeenCalled();
        expect(txSessionRepo.save).toHaveBeenCalledTimes(1);
      });

      it('a repeated request gets back the shift already opened, with its code, and opens nothing else', async () => {
        const { service, manager, idempotencyRepo, txSessionRepo, txRegisterRepo, notifications } =
          createService();
        // La clave ya estaba reclamada por la primera petición, que creó 'session-1'
        manager.query.mockResolvedValue([]);
        idempotencyRepo.findOneBy.mockResolvedValue({
          fingerprint: fingerprintOf(input),
          resourceId: 'session-1',
        });
        txSessionRepo.findOneByOrFail.mockResolvedValue(openSession({ movementCode: '654321' }));

        const opened = await service.open(COMPANY, 'admin-1', input, 'key-1');

        expect(idempotencyRepo.findOneBy).toHaveBeenCalledWith({
          companyId: COMPANY,
          userId: 'admin-1',
          operation: 'openCashSession',
          key: 'key-1',
        });
        expect(txSessionRepo.findOneByOrFail).toHaveBeenCalledWith({ id: 'session-1' });
        expect(opened.session.id).toBe('session-1');
        // Es el código del turno que ya existe, no uno nuevo
        expect(opened.code).toBe('654321');
        // Ni se vuelve a abrir la caja, ni a bloquearla, ni a avisar al cajero
        expect(txSessionRepo.save).not.toHaveBeenCalled();
        expect(txRegisterRepo.findOne).not.toHaveBeenCalled();
        expect(notifications.signalChange).not.toHaveBeenCalled();
      });

      it('the same key with other data is not a retry: it is refused and nothing is opened', async () => {
        const { service, manager, idempotencyRepo, txSessionRepo } = createService();
        manager.query.mockResolvedValue([]);
        idempotencyRepo.findOneBy.mockResolvedValue({
          fingerprint: fingerprintOf({ ...input, openingAmount: '999999' }),
          resourceId: 'session-1',
        });

        await expect(service.open(COMPANY, 'admin-1', input, 'key-1')).rejects.toThrow(
          ConflictException,
        );
        expect(txSessionRepo.findOneByOrFail).not.toHaveBeenCalled();
        expect(txSessionRepo.save).not.toHaveBeenCalled();
      });
    });
  });

  describe('close', () => {
    it('closes the shift with the expected cash, what was counted and the difference', async () => {
      const { service, txSessionRepo } = createService();
      txSessionRepo.findOne.mockResolvedValue(openSession());

      const session = await service.close(COMPANY, admin, {
        cashSessionId: 'session-1',
        countedAmount: '200000',
      });

      expect(session.status).toBe(CashSessionStatus.CLOSED);
      expect(session.closedBy).toBe('admin-1');
      expect(session.closedAt).toBeInstanceOf(Date);
      expect(session.expectedAmount?.toFixed(2)).toBe('200000.00');
      expect(session.countedAmount?.toFixed(2)).toBe('200000.00');
      expect(session.differenceAmount?.toFixed(2)).toBe('0.00');
      expect(session.notes).toBeNull();
    });

    it('lets any administrator close it, not only the one who opened it and not the cashier', async () => {
      const { service, txSessionRepo } = createService();
      txSessionRepo.findOne.mockResolvedValue(openSession({ openedBy: 'admin-2' }));

      const session = await service.close(COMPANY, admin, {
        cashSessionId: 'session-1',
        countedAmount: '200000',
      });

      expect(session.status).toBe(CashSessionStatus.CLOSED);
      expect(session.closedBy).toBe('admin-1');
    });

    it('counts cash sales and movements in the expected cash, and card sales out of it', async () => {
      const { service, txSessionRepo, paymentRepo, movementRepo } = createService();
      txSessionRepo.findOne.mockResolvedValue(openSession());
      paymentRepo.find.mockResolvedValue([cashPayment('80000'), cardPayment('30000')]);
      movementRepo.find.mockResolvedValue([movement('5000', CashMovementType.CASH_IN)]);

      // 200000 + 80000 + 5000
      const session = await service.close(COMPANY, admin, {
        cashSessionId: 'session-1',
        countedAmount: '285000',
      });

      expect(session.expectedAmount?.toFixed(2)).toBe('285000.00');
      expect(session.differenceAmount?.toFixed(2)).toBe('0.00');
    });

    it('needs notes when cash is missing, and leaves the difference negative', async () => {
      const { service, txSessionRepo } = createService();
      txSessionRepo.findOne.mockResolvedValue(openSession());

      await expect(
        service.close(COMPANY, admin, { cashSessionId: 'session-1', countedAmount: '190000' }),
      ).rejects.toThrow(BadRequestException);
      expect(txSessionRepo.save).not.toHaveBeenCalled();

      const session = await service.close(COMPANY, admin, {
        cashSessionId: 'session-1',
        countedAmount: '190000',
        notes: '  Faltan 10.000 del cambio ',
      });

      expect(session.differenceAmount?.toFixed(2)).toBe('-10000.00');
      expect(session.notes).toBe('Faltan 10.000 del cambio');
    });

    it('accepts a negative count, with its difference and the notes that explain it', async () => {
      const { service, txSessionRepo } = createService();
      txSessionRepo.findOne.mockResolvedValue(openSession());

      await expect(
        service.close(COMPANY, admin, { cashSessionId: 'session-1', countedAmount: '-5000' }),
      ).rejects.toThrow(BadRequestException);

      const session = await service.close(COMPANY, admin, {
        cashSessionId: 'session-1',
        countedAmount: '-5000',
        notes: 'La caja quedó debiendo: se pagó un reembolso de más',
      });

      expect(session.status).toBe(CashSessionStatus.CLOSED);
      expect(session.countedAmount?.toFixed(2)).toBe('-5000.00');
      // -5000 − 200000
      expect(session.differenceAmount?.toFixed(2)).toBe('-205000.00');
    });

    it('needs notes when there is more cash than expected, too', async () => {
      const { service, txSessionRepo } = createService();
      txSessionRepo.findOne.mockResolvedValue(openSession());

      await expect(
        service.close(COMPANY, admin, { cashSessionId: 'session-1', countedAmount: '210000' }),
      ).rejects.toThrow(BadRequestException);
      expect(txSessionRepo.save).not.toHaveBeenCalled();
    });

    it('counts the cash refunds of returns when it works out the expected cash to close', async () => {
      const { service, txSessionRepo, paymentRepo, refundRepo } = createService();
      txSessionRepo.findOne.mockResolvedValue(openSession());
      paymentRepo.find.mockResolvedValue([cashPayment('300000')]);
      refundRepo.find.mockResolvedValue([
        { amount: d('100000'), paymentMethod: { type: PaymentMethodType.CASH } },
      ]);

      // 200000 + 300000 − 100000
      const session = await service.close(COMPANY, admin, {
        cashSessionId: 'session-1',
        countedAmount: '400000',
      });

      expect(session.expectedAmount?.toFixed(2)).toBe('400000.00');
      expect(session.differenceAmount?.toFixed(2)).toBe('0.00');
    });

    it('deletes the draft sales left in the shift, with their lines and discount requests', async () => {
      const { service, txSessionRepo, saleRepo, saleItemRepo, discountRequestRepo } = createService();
      txSessionRepo.findOne.mockResolvedValue(openSession());
      saleRepo.find.mockResolvedValue([{ id: 'draft-1' }, { id: 'draft-2' }]);

      await service.close(COMPANY, admin, { cashSessionId: 'session-1', countedAmount: '200000' });

      // Solo los borradores de ESTE turno: ni cobradas ni anuladas ni de otro turno.
      expect(saleRepo.find).toHaveBeenCalledWith({
        where: { cashSessionId: 'session-1', status: SaleStatus.DRAFT },
        order: { id: 'ASC' },
        lock: { mode: 'pessimistic_write', onLocked: 'nowait' },
      });
      const drafts = ['draft-1', 'draft-2'];
      // Las solicitudes que estaban pendientes o aprobadas se buscan antes de borrarlas, para avisar
      expect(discountRequestRepo.find).toHaveBeenCalledWith({
        where: {
          saleId: In(drafts),
          status: In([DiscountRequestStatus.PENDING, DiscountRequestStatus.APPROVED]),
        },
      });
      expect(saleItemRepo.delete).toHaveBeenCalledWith({ saleId: In(drafts) });
      expect(discountRequestRepo.delete).toHaveBeenCalledWith({ saleId: In(drafts) });
      expect(saleRepo.delete).toHaveBeenCalledWith({ id: In(drafts) });
    });

    it('deletes the lines first, then the discount requests, then the sales, so nothing is left hanging', async () => {
      const { service, txSessionRepo, saleRepo, saleItemRepo, discountRequestRepo } = createService();
      txSessionRepo.findOne.mockResolvedValue(openSession());
      saleRepo.find.mockResolvedValue([{ id: 'draft-1' }]);

      await service.close(COMPANY, admin, { cashSessionId: 'session-1', countedAmount: '200000' });

      const order = (mock: { mock: { invocationCallOrder: number[] } }) => mock.mock.invocationCallOrder[0];
      expect(order(saleItemRepo.delete)).toBeLessThan(order(discountRequestRepo.delete));
      expect(order(discountRequestRepo.delete)).toBeLessThan(order(saleRepo.delete));
    });

    it('takes the discount requests of the deleted drafts off the approvers\' screens, and reads the pending ones\' notices', async () => {
      const { service, txSessionRepo, saleRepo, discountRequestRepo, notifications, manager } =
        createService();
      txSessionRepo.findOne.mockResolvedValue(openSession());
      saleRepo.find.mockResolvedValue([{ id: 'draft-1' }]);
      discountRequestRepo.find.mockResolvedValue([
        { id: 'request-1', status: DiscountRequestStatus.PENDING },
        { id: 'request-2', status: DiscountRequestStatus.APPROVED },
      ]);
      notifications.findUserIdsWithPermission.mockResolvedValue(['admin-1', 'admin-2']);

      await service.close(COMPANY, admin, { cashSessionId: 'session-1', countedAmount: '200000' });

      expect(notifications.findUserIdsWithPermission).toHaveBeenCalledWith(
        manager,
        COMPANY,
        PermissionCode.SALES_APPROVE_DISCOUNT,
      );
      // Solo la pendiente tenía un aviso de "solicitud nueva" sin leer
      expect(notifications.markEntityRead).toHaveBeenCalledTimes(1);
      expect(notifications.markEntityRead).toHaveBeenCalledWith(
        manager,
        NotificationEntityType.DISCOUNT_REQUEST,
        'request-1',
        [NotificationType.DISCOUNT_REQUESTED],
      );
      // En vivo se avisa de las dos a los administradores, menos a quien cierra el turno
      for (const entityId of ['request-1', 'request-2']) {
        expect(notifications.signalChange).toHaveBeenCalledWith(manager, {
          companyId: COMPANY,
          channel: NotificationChannel.DISCOUNTS,
          entityType: NotificationEntityType.DISCOUNT_REQUEST,
          entityId,
          recipientIds: ['admin-1', 'admin-2'],
          exceptUserId: 'admin-1',
        });
      }
    });

    it('does not look for approvers to warn when the drafts had no discount request', async () => {
      const { service, txSessionRepo, saleRepo, notifications } = createService();
      txSessionRepo.findOne.mockResolvedValue(openSession());
      saleRepo.find.mockResolvedValue([{ id: 'draft-1' }]);

      await service.close(COMPANY, admin, { cashSessionId: 'session-1', countedAmount: '200000' });

      expect(notifications.findUserIdsWithPermission).not.toHaveBeenCalled();
      expect(notifications.markEntityRead).not.toHaveBeenCalled();
    });

    it('closes without touching sales when no draft was left', async () => {
      const { service, txSessionRepo, saleRepo, saleItemRepo, discountRequestRepo } = createService();
      txSessionRepo.findOne.mockResolvedValue(openSession());

      await service.close(COMPANY, admin, { cashSessionId: 'session-1', countedAmount: '200000' });

      expect(discountRequestRepo.find).not.toHaveBeenCalled();
      expect(saleItemRepo.delete).not.toHaveBeenCalled();
      expect(discountRequestRepo.delete).not.toHaveBeenCalled();
      expect(saleRepo.delete).not.toHaveBeenCalled();
    });

    it('keeps the drafts when the shift cannot be closed', async () => {
      const { service, txSessionRepo, saleRepo } = createService();
      txSessionRepo.findOne.mockResolvedValue(openSession());
      saleRepo.find.mockResolvedValue([{ id: 'draft-1' }]);

      await expect(
        service.close(COMPANY, admin, { cashSessionId: 'session-1', countedAmount: '190000' }),
      ).rejects.toThrow(BadRequestException);

      expect(saleRepo.delete).not.toHaveBeenCalled();
    });

    it('locks the drafts of the shift, without waiting, BEFORE locking the shift: sale first, then shift, like every payment', async () => {
      const { service, txSessionRepo, saleRepo } = createService();
      txSessionRepo.findOne.mockResolvedValue(openSession());

      await service.close(COMPANY, admin, { cashSessionId: 'session-1', countedAmount: '200000' });

      expect(saleRepo.find).toHaveBeenCalledWith(
        expect.objectContaining({ lock: { mode: 'pessimistic_write', onLocked: 'nowait' } }),
      );
      // La primera lectura del turno (la que después lo bloquea) va después de bloquear las ventas
      expect(saleRepo.find.mock.invocationCallOrder[0]).toBeLessThan(
        txSessionRepo.findOne.mock.invocationCallOrder[0],
      );
    });

    it('locks the drafts in id order, so two closings at once do not cross each other', async () => {
      const { service, txSessionRepo, saleRepo } = createService();
      txSessionRepo.findOne.mockResolvedValue(openSession());

      await service.close(COMPANY, admin, { cashSessionId: 'session-1', countedAmount: '200000' });

      expect(saleRepo.find).toHaveBeenCalledWith(expect.objectContaining({ order: { id: 'ASC' } }));
    });

    it('is refused, without touching anything, when the cashier is using a draft at that moment (lock not available)', async () => {
      const { service, txSessionRepo, saleRepo, saleItemRepo, discountRequestRepo, notifications } =
        createService();
      txSessionRepo.findOne.mockResolvedValue(openSession());
      saleRepo.find.mockRejectedValue(lockNotAvailable());

      const closing = service.close(COMPANY, admin, {
        cashSessionId: 'session-1',
        countedAmount: '200000',
      });

      await expect(closing).rejects.toThrow(ConflictException);
      await expect(closing).rejects.toThrow('El cajero está usando una venta');
      // Ni siquiera se llega a bloquear el turno, y nada se borra, se guarda ni se avisa
      expect(txSessionRepo.findOne).not.toHaveBeenCalled();
      expect(saleItemRepo.delete).not.toHaveBeenCalled();
      expect(discountRequestRepo.delete).not.toHaveBeenCalled();
      expect(saleRepo.delete).not.toHaveBeenCalled();
      expect(txSessionRepo.save).not.toHaveBeenCalled();
      expect(notifications.signalChange).not.toHaveBeenCalled();
    });

    it('lets any other error of the lock through as it is', async () => {
      const { service, txSessionRepo, saleRepo } = createService();
      txSessionRepo.findOne.mockResolvedValue(openSession());
      saleRepo.find.mockRejectedValue(new Error('connection lost'));

      await expect(
        service.close(COMPANY, admin, { cashSessionId: 'session-1', countedAmount: '200000' }),
      ).rejects.toThrow('connection lost');
    });

    it('lets the cashier terminal know the shift was closed, live, except the administrator who closed it', async () => {
      const { service, txSessionRepo, notifications, manager } = createService();
      txSessionRepo.findOne.mockResolvedValue(openSession());

      await service.close(COMPANY, admin, { cashSessionId: 'session-1', countedAmount: '200000' });

      expect(notifications.signalChange).toHaveBeenCalledTimes(1);
      expect(notifications.signalChange).toHaveBeenCalledWith(manager, {
        companyId: COMPANY,
        channel: NotificationChannel.CASH,
        entityType: NotificationEntityType.CASH_SESSION,
        entityId: 'session-1',
        recipientIds: ['cashier-1'],
        exceptUserId: 'admin-1',
      });
    });

    it('signals nobody when the closing is rejected', async () => {
      const { service, txSessionRepo, notifications } = createService();
      txSessionRepo.findOne.mockResolvedValue(openSession());

      await expect(
        service.close(COMPANY, admin, { cashSessionId: 'session-1', countedAmount: '190000' }),
      ).rejects.toThrow(BadRequestException);
      expect(notifications.signalChange).not.toHaveBeenCalled();
    });

    it('does not close a shift twice', async () => {
      const { service, txSessionRepo } = createService();
      txSessionRepo.findOne.mockResolvedValue(openSession({ status: CashSessionStatus.CLOSED }));

      await expect(
        service.close(COMPANY, admin, { cashSessionId: 'session-1', countedAmount: '200000' }),
      ).rejects.toThrow(ConflictException);
      expect(txSessionRepo.save).not.toHaveBeenCalled();
    });

    it('cannot reach a shift of another company, and does not even lock its sales', async () => {
      const { service, txSessionRepo, saleRepo } = createService();
      txSessionRepo.existsBy.mockResolvedValueOnce(false);

      await expect(
        service.close(COMPANY, admin, { cashSessionId: 'session-9', countedAmount: '0' }),
      ).rejects.toThrow(NotFoundException);
      expect(txSessionRepo.existsBy).toHaveBeenCalledWith({
        id: 'session-9',
        cashRegister: { store: { companyId: COMPANY } },
      });
      expect(saleRepo.find).not.toHaveBeenCalled();
      expect(txSessionRepo.findOne).not.toHaveBeenCalled();
      expect(txSessionRepo.save).not.toHaveBeenCalled();
    });

    it('answers "not found" when the shift disappears before it can be locked', async () => {
      const { service, txSessionRepo } = createService();
      txSessionRepo.findOne.mockResolvedValue(null);

      await expect(
        service.close(COMPANY, admin, { cashSessionId: 'session-9', countedAmount: '0' }),
      ).rejects.toThrow(NotFoundException);
      expect(txSessionRepo.save).not.toHaveBeenCalled();
    });

    describe('with an idempotency key', () => {
      const closing = { cashSessionId: 'session-1', countedAmount: '200000' };

      it('claims the key first, in the same transaction as the closing, and links it to the closed shift', async () => {
        const { service, txSessionRepo, saleRepo, manager, dataSource } = createService();
        txSessionRepo.findOne.mockResolvedValue(openSession());

        await service.close(COMPANY, admin, closing, 'key-1');

        expect(dataSource.transaction).toHaveBeenCalledTimes(1);
        expect(manager.query).toHaveBeenNthCalledWith(
          1,
          expect.stringContaining('INSERT INTO "idempotency_keys"'),
          [COMPANY, 'admin-1', 'closeCashSession', 'key-1', fingerprintOf(closing)],
        );
        expect(manager.query).toHaveBeenNthCalledWith(
          2,
          expect.stringContaining('UPDATE "idempotency_keys"'),
          ['claim-1', 'cash_session', 'session-1'],
        );
        // La clave se reclama antes de bloquear ventas o turno
        expect(manager.query.mock.invocationCallOrder[0]).toBeLessThan(
          saleRepo.find.mock.invocationCallOrder[0],
        );
      });

      it('claims nothing without a key: it works as before', async () => {
        const { service, txSessionRepo, manager, idempotencyRepo } = createService();
        txSessionRepo.findOne.mockResolvedValue(openSession());

        await service.close(COMPANY, admin, closing);

        expect(manager.query).not.toHaveBeenCalled();
        expect(idempotencyRepo.findOneBy).not.toHaveBeenCalled();
      });

      it('a repeated request gets back the shift already closed, instead of failing with "already closed"', async () => {
        const {
          service,
          txSessionRepo,
          saleRepo,
          idempotencyRepo,
          manager,
          notifications,
        } = createService();
        // La clave ya estaba reclamada por la primera petición, que cerró el turno
        manager.query.mockResolvedValue([]);
        idempotencyRepo.findOneBy.mockResolvedValue({
          fingerprint: fingerprintOf(closing),
          resourceId: 'session-1',
        });
        const closed = openSession({ status: CashSessionStatus.CLOSED });
        txSessionRepo.findOneByOrFail.mockResolvedValue(closed);

        const session = await service.close(COMPANY, admin, closing, 'key-1');

        expect(txSessionRepo.findOneByOrFail).toHaveBeenCalledWith({ id: 'session-1' });
        expect(session).toBe(closed);
        // No se bloquea nada, no se borra nada, no se guarda de nuevo y no se vuelve a avisar
        expect(saleRepo.find).not.toHaveBeenCalled();
        expect(txSessionRepo.findOne).not.toHaveBeenCalled();
        expect(saleRepo.delete).not.toHaveBeenCalled();
        expect(txSessionRepo.save).not.toHaveBeenCalled();
        expect(notifications.signalChange).not.toHaveBeenCalled();
      });

      it('the same key with other data is not a retry: it is refused and nothing is closed', async () => {
        const { service, txSessionRepo, idempotencyRepo, manager } = createService();
        manager.query.mockResolvedValue([]);
        idempotencyRepo.findOneBy.mockResolvedValue({
          fingerprint: fingerprintOf({ ...closing, countedAmount: '999999' }),
          resourceId: 'session-1',
        });

        await expect(service.close(COMPANY, admin, closing, 'key-1')).rejects.toThrow(
          ConflictException,
        );
        expect(txSessionRepo.findOneByOrFail).not.toHaveBeenCalled();
        expect(txSessionRepo.save).not.toHaveBeenCalled();
      });

      it('a closing that fails does not link the key to anything', async () => {
        const { service, txSessionRepo, manager } = createService();
        txSessionRepo.findOne.mockResolvedValue(openSession());

        await expect(
          service.close(COMPANY, admin, { ...closing, countedAmount: '190000' }, 'key-1'),
        ).rejects.toThrow(BadRequestException);

        // Solo el INSERT que reclama (que se deshace con la transacción); nunca el UPDATE que la enlaza
        expect(manager.query).toHaveBeenCalledTimes(1);
        expect(manager.query).toHaveBeenCalledWith(
          expect.stringContaining('INSERT INTO "idempotency_keys"'),
          expect.anything(),
        );
      });
    });
  });

  describe('getMovementCode', () => {
    it('gives the administrator the code of an open shift', async () => {
      const { service, sessionRepo } = createService();
      sessionRepo.findOne.mockResolvedValue(openSession());

      await expect(service.getMovementCode(COMPANY, admin, 'session-1')).resolves.toBe('123456');
    });

    it('never gives it to the cashier, without even looking the shift up', async () => {
      const { service, sessionRepo } = createService();

      await expect(service.getMovementCode(COMPANY, cashier, 'session-1')).rejects.toThrow(
        ForbiddenException,
      );
      expect(sessionRepo.findOne).not.toHaveBeenCalled();
    });

    it('does not give it once the shift is closed, because it no longer works', async () => {
      const { service, sessionRepo } = createService();
      sessionRepo.findOne.mockResolvedValue(openSession({ status: CashSessionStatus.CLOSED }));

      await expect(service.getMovementCode(COMPANY, admin, 'session-1')).rejects.toThrow(
        ConflictException,
      );
    });

    it('cannot reach the shift of another company', async () => {
      const { service, sessionRepo } = createService();
      sessionRepo.findOne.mockResolvedValue(null);

      await expect(service.getMovementCode(COMPANY, admin, 'session-9')).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  describe('regenerateMovementCode', () => {
    it('changes the code of an open shift and unlocks the movements', async () => {
      const { service, txSessionRepo } = createService();
      const session = openSession({ movementCode: '111111', movementCodeFailures: 5 });
      txSessionRepo.findOne.mockResolvedValue(session);

      const code = await service.regenerateMovementCode(COMPANY, admin, 'session-1');

      expect(code).toMatch(CASH_CODE_PATTERN);
      expect(session.movementCode).toBe(code);
      expect(session.movementCodeFailures).toBe(0);
      expect(txSessionRepo.save).toHaveBeenCalledWith(session);
    });

    it('never lets the cashier change it', async () => {
      const { service, dataSource } = createService();

      await expect(service.regenerateMovementCode(COMPANY, cashier, 'session-1')).rejects.toThrow(
        ForbiddenException,
      );
      expect(dataSource.transaction).not.toHaveBeenCalled();
    });

    it('only changes the code of an open shift', async () => {
      const { service, txSessionRepo } = createService();
      txSessionRepo.findOne.mockResolvedValue(openSession({ status: CashSessionStatus.CLOSED }));

      await expect(service.regenerateMovementCode(COMPANY, admin, 'session-1')).rejects.toThrow(
        ConflictException,
      );
      expect(txSessionRepo.save).not.toHaveBeenCalled();
    });
  });

  describe('verifyMovementCode', () => {
    it('accepts the right code without writing anything', async () => {
      const { service, manager, txSessionRepo } = createService();

      await expect(
        service.verifyMovementCode(manager as never, openSession() as never, '123456'),
      ).resolves.toBe(CashCodeVerdict.OK);
      expect(txSessionRepo.save).not.toHaveBeenCalled();
    });

    it('starts the count of mistakes over after a right code', async () => {
      const { service, manager, txSessionRepo } = createService();
      const session = openSession({ movementCodeFailures: 3 });

      await expect(
        service.verifyMovementCode(manager as never, session as never, '123456'),
      ).resolves.toBe(CashCodeVerdict.OK);
      expect(session.movementCodeFailures).toBe(0);
      expect(txSessionRepo.save).toHaveBeenCalledWith(session);
    });

    it('rejects a wrong code and counts the mistake', async () => {
      const { service, manager, txSessionRepo } = createService();
      const session = openSession();

      await expect(
        service.verifyMovementCode(manager as never, session as never, '654321'),
      ).resolves.toBe(CashCodeVerdict.WRONG);
      expect(session.movementCodeFailures).toBe(1);
      expect(txSessionRepo.save).toHaveBeenCalledWith(session);
    });

    it('locks the movements after 5 mistakes in a row, even for the right code', async () => {
      const { service, manager, txSessionRepo } = createService();
      const session = openSession({ movementCodeFailures: 4 });

      // El quinto error todavía se responde como error; el siguiente intento ya está bloqueado.
      await expect(
        service.verifyMovementCode(manager as never, session as never, '000000'),
      ).resolves.toBe(CashCodeVerdict.WRONG);
      expect(session.movementCodeFailures).toBe(5);

      txSessionRepo.save.mockClear();
      await expect(
        service.verifyMovementCode(manager as never, session as never, '123456'),
      ).resolves.toBe(CashCodeVerdict.LOCKED);
      expect(session.movementCodeFailures).toBe(5);
      expect(txSessionRepo.save).not.toHaveBeenCalled();
    });
  });

  describe('lockOpen', () => {
    it('brings the shift locked, with its register loaded from the first read', async () => {
      const { service, manager, txSessionRepo } = createService();
      txSessionRepo.findOne
        .mockResolvedValueOnce(openSession({ cashRegister: register({ storeId: 'store-7' }) }))
        .mockResolvedValueOnce(openSession({ cashRegister: undefined }));

      const session = await service.lockOpen(manager as never, COMPANY, 'session-1', cashier);

      expect(txSessionRepo.findOne).toHaveBeenNthCalledWith(1, {
        where: { id: 'session-1', cashRegister: { store: { companyId: COMPANY } } },
        relations: { cashRegister: true },
      });
      expect(txSessionRepo.findOne).toHaveBeenNthCalledWith(2, {
        where: { id: 'session-1' },
        lock: { mode: 'pessimistic_write' },
      });
      expect(session.cashRegister.storeId).toBe('store-7');
    });

    it('only lets the cashier assigned to the shift operate it, without even locking it', async () => {
      const { service, manager, txSessionRepo } = createService();
      txSessionRepo.findOne.mockResolvedValue(openSession());

      await expect(
        service.lockOpen(manager as never, COMPANY, 'session-1', otherCashier),
      ).rejects.toThrow(ForbiddenException);
      expect(txSessionRepo.findOne).toHaveBeenCalledTimes(1);
    });

    it('does not let whoever opens and closes shifts operate a shift that is not theirs: only the assigned cashier charges', async () => {
      const { service, manager, txSessionRepo } = createService();
      txSessionRepo.findOne.mockResolvedValue(openSession());

      // El administrador (admin-1) abrió el turno de 'cashier-1': no lo puede cobrar por ese turno
      await expect(service.lockOpen(manager as never, COMPANY, 'session-1', admin)).rejects.toThrow(
        ForbiddenException,
      );
      // Ni siquiera se bloquea el turno
      expect(txSessionRepo.findOne).toHaveBeenCalledTimes(1);
    });

    it('lets the administrator operate a shift when they are the cashier assigned to it: to charge, they assign themselves', async () => {
      const { service, manager, txSessionRepo } = createService();
      txSessionRepo.findOne.mockResolvedValue(openSession({ cashierId: 'admin-1' }));

      await expect(
        service.lockOpen(manager as never, COMPANY, 'session-1', admin),
      ).resolves.toMatchObject({ id: 'session-1', cashierId: 'admin-1' });
      expect(txSessionRepo.findOne).toHaveBeenLastCalledWith({
        where: { id: 'session-1' },
        lock: { mode: 'pessimistic_write' },
      });
    });

    it('does not let someone who can only see every shift operate it: that takes being its assigned cashier', async () => {
      const { service, manager, txSessionRepo } = createService();
      txSessionRepo.findOne.mockResolvedValue(openSession());

      await expect(service.lockOpen(manager as never, COMPANY, 'session-1', auditor)).rejects.toThrow(
        ForbiddenException,
      );
      expect(txSessionRepo.findOne).toHaveBeenCalledTimes(1);
    });

    it('only works on an open shift', async () => {
      const { service, manager, txSessionRepo } = createService();
      txSessionRepo.findOne.mockResolvedValue(openSession({ status: CashSessionStatus.CLOSED }));

      await expect(
        service.lockOpen(manager as never, COMPANY, 'session-1', cashier),
      ).rejects.toThrow(ConflictException);
    });

    it('cannot reach a shift of another company', async () => {
      const { service, manager, txSessionRepo } = createService();
      txSessionRepo.findOne.mockResolvedValue(null);

      await expect(
        service.lockOpen(manager as never, COMPANY, 'session-9', cashier),
      ).rejects.toThrow(NotFoundException);
    });
  });

  describe('lockOpenForClosing', () => {
    it('brings any open shift of the company locked, whoever its cashier is', async () => {
      const { service, manager, txSessionRepo } = createService();
      txSessionRepo.findOne.mockResolvedValue(openSession());

      await expect(
        service.lockOpenForClosing(manager as never, COMPANY, 'session-1'),
      ).resolves.toMatchObject({ id: 'session-1', cashierId: 'cashier-1' });
      expect(txSessionRepo.findOne).toHaveBeenLastCalledWith({
        where: { id: 'session-1' },
        lock: { mode: 'pessimistic_write' },
      });
    });

    it('only works on an open shift', async () => {
      const { service, manager, txSessionRepo } = createService();
      txSessionRepo.findOne.mockResolvedValue(openSession({ status: CashSessionStatus.CLOSED }));

      await expect(
        service.lockOpenForClosing(manager as never, COMPANY, 'session-1'),
      ).rejects.toThrow(ConflictException);
    });

    it('cannot reach a shift of another company', async () => {
      const { service, manager, txSessionRepo } = createService();
      txSessionRepo.findOne.mockResolvedValue(null);

      await expect(
        service.lockOpenForClosing(manager as never, COMPANY, 'session-9'),
      ).rejects.toThrow(NotFoundException);
    });
  });
});
