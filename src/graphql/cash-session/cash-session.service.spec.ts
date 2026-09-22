import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { Decimal } from 'decimal.js';
import { QueryFailedError } from 'typeorm';
import { RecordStatus } from '../../common/enums/record-status.enum.js';
import { CashMovementType } from '../cash-movement/entities/cash-movement-type.enum.js';
import { CashMovement } from '../cash-movement/entities/cash-movement.entity.js';
import { CashRegister } from '../cash-register/entities/cash-register.entity.js';
import { LocationType } from '../location/entities/location-type.enum.js';
import { Location } from '../location/entities/location.entity.js';
import { PaymentMethodType } from '../payment-method/entities/payment-method-type.enum.js';
import { RolePermission } from '../role-permission/entities/role-permission.entity.js';
import { SalePayment } from '../sale-payment/entities/sale-payment.entity.js';
import { RefundPayment } from '../sale-return/entities/refund-payment.entity.js';
import { UserCompanyRole } from '../user-company-role/entities/user-company-role.entity.js';
import { UserLocationAccess } from '../user-location-access/entities/user-location-access.entity.js';
import type { CashActor } from './cash-actor.js';
import { CASH_CODE_PATTERN, CashCodeVerdict } from './cash-code.js';
import { CashSessionService } from './cash-session.service.js';
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
    existsBy: vi.fn().mockResolvedValue(false),
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
  // Lo que lee loadCompanyAccess para saber si el cajero asignado puede cobrar: por defecto, es un
  // miembro con el rol Caja, que trae cash.register_payment.
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
  const manager = {
    getRepository: (entity: unknown) =>
      entity === CashSession
        ? txSessionRepo
        : entity === CashRegister
          ? txRegisterRepo
          : entity === UserLocationAccess
            ? accessRepo
            : entity === Location
              ? locationRepo
              : entity === SalePayment
                ? paymentRepo
                : entity === CashMovement
                  ? movementRepo
                  : entity === RefundPayment
                    ? refundRepo
                    : undefined,
  };
  const dataSource = {
    manager,
    transaction: vi.fn(async (fn: (manager: unknown) => unknown) => fn(manager)),
    getRepository: (entity: unknown) =>
      entity === UserCompanyRole
        ? membershipRepo
        : entity === RolePermission
          ? rolePermissionRepo
          : entity === Location
            ? locationRepo
            : entity === UserLocationAccess
              ? accessRepo
              : undefined,
  };

  const service = new CashSessionService(sessionRepo as never, dataSource as never);
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
    membershipRepo,
    rolePermissionRepo,
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
      });
    });

    it('shows every shift to whoever can see them all', async () => {
      const { service, sessionRepo } = createService();

      await service.findAll(COMPANY, auditor);

      expect(sessionRepo.find).toHaveBeenCalledWith({
        where: { cashRegister: { store: { companyId: COMPANY } } },
        order: { openedAt: 'DESC' },
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
      });
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

      await expect(service.open(COMPANY, 'admin-1', opening)).rejects.toThrow(ConflictException);
      expect(txSessionRepo.existsBy).toHaveBeenLastCalledWith({
        cashierId: 'cashier-1',
        status: CashSessionStatus.OPEN,
      });
      expect(txSessionRepo.save).not.toHaveBeenCalled();
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

    it('does not close a shift twice', async () => {
      const { service, txSessionRepo } = createService();
      txSessionRepo.findOne.mockResolvedValue(openSession({ status: CashSessionStatus.CLOSED }));

      await expect(
        service.close(COMPANY, admin, { cashSessionId: 'session-1', countedAmount: '200000' }),
      ).rejects.toThrow(ConflictException);
      expect(txSessionRepo.save).not.toHaveBeenCalled();
    });

    it('cannot reach a shift of another company', async () => {
      const { service, txSessionRepo } = createService();
      txSessionRepo.findOne.mockResolvedValue(null);

      await expect(
        service.close(COMPANY, admin, { cashSessionId: 'session-9', countedAmount: '0' }),
      ).rejects.toThrow(NotFoundException);
      expect(txSessionRepo.save).not.toHaveBeenCalled();
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

    it('does not let the administrator who opened it charge in it: one cashier per register', async () => {
      const { service, manager, txSessionRepo } = createService();
      txSessionRepo.findOne.mockResolvedValue(openSession());

      await expect(service.lockOpen(manager as never, COMPANY, 'session-1', admin)).rejects.toThrow(
        ForbiddenException,
      );
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
