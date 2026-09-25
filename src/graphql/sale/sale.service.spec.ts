import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { Decimal } from 'decimal.js';
import { In } from 'typeorm';
import { PermissionCode } from '../../common/enums/permission-code.enum.js';
import { RecordStatus } from '../../common/enums/record-status.enum.js';
import type { CashActor } from '../cash-session/cash-actor.js';
import {
  ACTIVE_DISCOUNT_REQUEST_STATUSES,
  DiscountRequestStatus,
} from '../discount-request/entities/discount-request-status.enum.js';
import { DiscountRequest } from '../discount-request/entities/discount-request.entity.js';
import { IdempotencyKey } from '../idempotency/entities/idempotency-key.entity.js';
import { LocationType } from '../location/entities/location-type.enum.js';
import { Location } from '../location/entities/location.entity.js';
import { NotificationChannel } from '../notification/entities/notification-channel.enum.js';
import { NotificationEntityType } from '../notification/entities/notification-entity-type.enum.js';
import { NotificationType } from '../notification/entities/notification-type.enum.js';
import { User } from '../user/entities/user.entity.js';
import { UserCompanyRole } from '../user-company-role/entities/user-company-role.entity.js';
import { UserLocationAccess } from '../user-location-access/entities/user-location-access.entity.js';
import { SaleItemType } from './entities/sale-item-type.enum.js';
import { SaleItem } from './entities/sale-item.entity.js';
import { SaleStatus } from './entities/sale-status.enum.js';
import type { SaleActor } from './sale-actor.js';
import { SALE_SERIES } from './sale-number.js';
import { SaleService } from './sale.service.js';

function createService() {
  // El constructor de consultas de findAll: cada paso devuelve el mismo objeto, como el de verdad.
  const listQuery = {
    where: vi.fn().mockReturnThis(),
    andWhere: vi.fn().mockReturnThis(),
    addSelect: vi.fn().mockReturnThis(),
    orderBy: vi.fn().mockReturnThis(),
    addOrderBy: vi.fn().mockReturnThis(),
    limit: vi.fn().mockReturnThis(),
    offset: vi.fn().mockReturnThis(),
    getRawAndEntities: vi.fn().mockResolvedValue({ entities: [], raw: [] }),
  };
  const saleRepo = { findOneBy: vi.fn(), createQueryBuilder: vi.fn((_alias: string) => listQuery) };
  const saleItemRepo = { find: vi.fn().mockResolvedValue([]) };
  const txSaleRepo = {
    create: vi.fn((value: unknown) => value),
    save: vi.fn(async (value: object) => ({ id: 'sale-1', ...value })),
    findOne: vi.fn(),
    // Lo que un reintento con la misma clave vuelve a cargar por su id
    findOneByOrFail: vi.fn(async ({ id }: { id: string }) => draft({ id })),
  };
  const txItemRepo = {
    create: vi.fn((value: unknown) => value),
    save: vi.fn(async (value: object) => ({ id: 'item-1', ...value })),
    find: vi.fn().mockResolvedValue([]),
    findOneBy: vi.fn(),
    delete: vi.fn().mockResolvedValue(undefined),
  };
  const txRequestRepo = {
    existsBy: vi.fn().mockResolvedValue(false),
    // Las solicitudes activas de la venta que se retiran al cancelarla (ninguna por defecto)
    find: vi.fn().mockResolvedValue([]),
    update: vi.fn().mockResolvedValue(undefined),
  };
  const locationRepo = {
    findOneBy: vi.fn().mockResolvedValue({ id: 'store-1', name: 'Tienda centro', status: RecordStatus.ACTIVE }),
  };
  const accessRepo = { existsBy: vi.fn().mockResolvedValue(true) };
  const membershipRepo = { existsBy: vi.fn().mockResolvedValue(true) };
  const userRepo = { existsBy: vi.fn().mockResolvedValue(true) };
  const sequences = { next: vi.fn().mockResolvedValue(7) };
  const cashSessions = {
    lockOpen: vi.fn().mockResolvedValue({ id: 'session-1', cashRegister: { storeId: 'store-1' } }),
  };
  // A quiénes se avisa cuando se retira una solicitud de descuento (los que aprueban descuentos)
  const notifications = {
    notify: vi.fn().mockResolvedValue(null),
    findUserIdsWithPermission: vi.fn().mockResolvedValue(['admin-1', 'admin-2']),
    markEntityRead: vi.fn().mockResolvedValue(0),
    signalChange: vi.fn(),
  };

  // Las claves de idempotencia que guardaría la base: reclamar una nueva la inserta; si ya estaba
  // (ON CONFLICT DO NOTHING) no inserta nada y el reintento la busca para devolver lo que se creó.
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
      entity === Location
        ? locationRepo
        : entity === UserLocationAccess
          ? accessRepo
          : entity === UserCompanyRole
            ? membershipRepo
            : entity === User
              ? userRepo
              : entity === SaleItem
                ? txItemRepo
                : entity === DiscountRequest
                  ? txRequestRepo
                  : entity === IdempotencyKey
                    ? keyRepo
                    : txSaleRepo,
  };
  const dataSource = {
    transaction: vi.fn(async (fn: (manager: unknown) => unknown) => fn(manager)),
  };

  const service = new SaleService(
    saleRepo as never,
    saleItemRepo as never,
    dataSource as never,
    sequences as never,
    cashSessions as never,
    notifications as never,
  );
  return {
    service,
    listQuery,
    saleRepo,
    saleItemRepo,
    txSaleRepo,
    txItemRepo,
    txRequestRepo,
    locationRepo,
    accessRepo,
    membershipRepo,
    userRepo,
    sequences,
    cashSessions,
    notifications,
    keyRepo,
    query,
    manager,
    dataSource,
  };
}

const COMPANY = 'company-1';
const CASHIER = 'cashier-1';
const CASHIER_ACTOR: CashActor = { userId: CASHIER, canViewAll: false, canManageShifts: false };
const ANOTHER_CASHIER_ACTOR: CashActor = { userId: 'cashier-2', canViewAll: false, canManageShifts: false };
const input = { storeId: 'store-1', cashSessionId: 'session-1' };

// Quién pregunta por ventas: un cajero (solo lee las suyas), quien ve todo y quien aprueba descuentos o
// devoluciones (lee cualquiera por su id, pero no ve el histórico completo).
const CASHIER_READER: SaleActor = { userId: CASHIER, canViewAll: false, canReadAny: false };
const ADMIN_READER: SaleActor = { userId: 'admin-1', canViewAll: true, canReadAny: true };
const APPROVER_READER: SaleActor = { userId: 'approver-1', canViewAll: false, canReadAny: true };

// Quien cancela: el administrador (sales.cancel) o un cajero sin ese permiso
const ADMIN_CANCEL = { userId: 'admin-1', canCancelAny: true };

const d = (value: string) => new Decimal(value);

// Una venta en borrador tal como la entrega la base de datos: sin consecutivo todavía (se asigna al
// cobrar) y del cajero CASHIER.
const draft = (overrides: Record<string, unknown> = {}) => ({
  id: 'sale-1',
  companyId: COMPANY,
  storeId: 'store-1',
  saleNumber: null,
  cashierId: CASHIER,
  sellerId: null,
  status: SaleStatus.DRAFT,
  subtotal: d('0'),
  discountTotal: d('0'),
  generalDiscount: d('0'),
  total: d('0'),
  ...overrides,
});

// Lo que la base devuelve de una línea al recalcular los totales.
const line = (total: string, discountAmount = '0') => ({
  total: d(total),
  discountAmount: d(discountAmount),
});

const newItem = {
  saleId: 'sale-1',
  description: 'Flete',
  quantity: '2',
  unitPrice: '50000',
};

describe('SaleService', () => {
  describe('findAll', () => {
    it('looks inside the company, in a single query for the whole list', async () => {
      const { service, saleRepo, listQuery } = createService();

      await service.findAll(COMPANY, ADMIN_READER);

      expect(saleRepo.createQueryBuilder).toHaveBeenCalledWith('sale');
      expect(listQuery.where).toHaveBeenCalledWith('sale.companyId = :companyId', { companyId: COMPANY });
      expect(listQuery.getRawAndEntities).toHaveBeenCalledTimes(1);
    });

    it('without sales.view_all, only lists the sales the actor cashiered or sold', async () => {
      const { service, listQuery } = createService();

      await service.findAll(COMPANY, CASHIER_READER);

      expect(listQuery.andWhere).toHaveBeenCalledTimes(1);
      expect(listQuery.andWhere).toHaveBeenCalledWith('(sale.cashierId = :me OR sale.sellerId = :me)', {
        me: CASHIER,
      });
    });

    it('without sales.view_all, the cashier filter does not let anyone look at another cashier', async () => {
      const { service, listQuery } = createService();

      await service.findAll(COMPANY, CASHIER_READER, { cashierId: 'cashier-9' });

      expect(listQuery.andWhere).toHaveBeenCalledTimes(1);
      expect(listQuery.andWhere).toHaveBeenCalledWith('(sale.cashierId = :me OR sale.sellerId = :me)', {
        me: CASHIER,
      });
    });

    it('without sales.view_all, status and store narrow the list on top of its own sales', async () => {
      const { service, listQuery } = createService();

      await service.findAll(COMPANY, CASHIER_READER, { status: SaleStatus.DRAFT, storeId: 'store-1' });

      expect(listQuery.andWhere).toHaveBeenCalledWith('sale.status = :status', { status: SaleStatus.DRAFT });
      expect(listQuery.andWhere).toHaveBeenCalledWith('sale.storeId = :storeId', { storeId: 'store-1' });
      expect(listQuery.andWhere).toHaveBeenCalledWith('(sale.cashierId = :me OR sale.sellerId = :me)', {
        me: CASHIER,
      });
    });

    it('with sales.view_all, lists every sale of the company', async () => {
      const { service, listQuery } = createService();

      await service.findAll(COMPANY, ADMIN_READER);

      expect(listQuery.andWhere).not.toHaveBeenCalled();
    });

    it('with sales.view_all, can narrow the list down to one cashier', async () => {
      const { service, listQuery } = createService();

      await service.findAll(COMPANY, ADMIN_READER, { cashierId: CASHIER });

      expect(listQuery.andWhere).toHaveBeenCalledTimes(1);
      expect(listQuery.andWhere).toHaveBeenCalledWith('sale.cashierId = :cashierId', { cashierId: CASHIER });
    });

    it('narrows by the date of the sale: when it was paid, or when it was created if it is still a draft', async () => {
      const { service, listQuery } = createService();
      const from = new Date('2026-09-01T00:00:00Z');
      const to = new Date('2026-09-30T23:59:59Z');

      await service.findAll(COMPANY, ADMIN_READER, { from, to });

      expect(listQuery.andWhere).toHaveBeenCalledWith('COALESCE(sale.completedAt, sale.createdAt) >= :from', {
        from,
      });
      expect(listQuery.andWhere).toHaveBeenCalledWith('COALESCE(sale.completedAt, sale.createdAt) <= :to', {
        to,
      });
    });

    it('lists the newest first by that same date, with the id to break ties', async () => {
      const { service, listQuery } = createService();

      await service.findAll(COMPANY, ADMIN_READER);

      expect(listQuery.orderBy).toHaveBeenCalledWith('COALESCE(sale.completedAt, sale.createdAt)', 'DESC');
      expect(listQuery.addOrderBy).toHaveBeenCalledWith('sale.id', 'DESC');
    });

    it.each([
      [undefined, 200],
      [50, 50],
      [9999, 500],
      [0, 1],
      [-3, 1],
    ])('asking for a limit of %s returns at most %s (200 by default, never over 500, never under 1)', async (limit, expected) => {
      const { service, listQuery } = createService();

      await service.findAll(COMPANY, ADMIN_READER, { limit });

      expect(listQuery.limit).toHaveBeenCalledWith(expected);
    });

    it.each([
      [undefined, 0],
      [40, 40],
      [-5, 0],
    ])('an offset of %s skips %s sales (never a negative number)', async (offset, expected) => {
      const { service, listQuery } = createService();

      await service.findAll(COMPANY, ADMIN_READER, { offset });

      expect(listQuery.offset).toHaveBeenCalledWith(expected);
    });

    it('brings the number of lines of each sale in that same query', async () => {
      const { service, listQuery } = createService();
      // El COUNT puede llegar como texto según el driver; una fila sin dato cuenta como cero.
      listQuery.getRawAndEntities.mockResolvedValue({
        entities: [{ id: 'sale-1' }, { id: 'sale-2' }, { id: 'sale-3' }],
        raw: [{ itemCount: '3' }, { itemCount: 0 }],
      });

      const sales = await service.findAll(COMPANY, ADMIN_READER);

      expect(listQuery.addSelect).toHaveBeenCalledWith(expect.stringContaining('sale_items'), 'itemCount');
      expect(sales.map((sale) => (sale as unknown as { itemCount: number }).itemCount)).toEqual([3, 0, 0]);
    });
  });

  describe('findOne', () => {
    it('looks the sale up inside the company, so a sale of another company does not exist', async () => {
      const { service, saleRepo } = createService();
      saleRepo.findOneBy.mockResolvedValue(null);

      await expect(service.findOne(COMPANY, 'sale-9')).rejects.toThrow(NotFoundException);
      expect(saleRepo.findOneBy).toHaveBeenCalledWith({ id: 'sale-9', companyId: COMPANY });
    });
  });

  // Lo que se le ofrece a un usuario: una venta suya (la cobró o la vendió), o cualquiera si ve todo o
  // aprueba descuentos o devoluciones. Una ajena responde como si no existiera.
  describe('findVisible', () => {
    it('lets a cashier read a sale they cashiered', async () => {
      const { service, saleRepo } = createService();
      saleRepo.findOneBy.mockResolvedValue(draft({ cashierId: CASHIER }));

      await expect(service.findVisible(COMPANY, CASHIER_READER, 'sale-1')).resolves.toMatchObject({
        id: 'sale-1',
      });
      expect(saleRepo.findOneBy).toHaveBeenCalledWith({ id: 'sale-1', companyId: COMPANY });
    });

    it('lets a seller read a sale they sold, even if someone else charged it', async () => {
      const { service, saleRepo } = createService();
      saleRepo.findOneBy.mockResolvedValue(draft({ cashierId: 'cashier-9', sellerId: CASHIER }));

      await expect(service.findVisible(COMPANY, CASHIER_READER, 'sale-1')).resolves.toMatchObject({
        id: 'sale-1',
      });
    });

    it('answers the sale of another cashier as if it did not exist, without saying it is there', async () => {
      const { service, saleRepo } = createService();
      saleRepo.findOneBy.mockResolvedValue(draft({ cashierId: 'cashier-9', sellerId: 'seller-9' }));

      await expect(service.findVisible(COMPANY, CASHIER_READER, 'sale-1')).rejects.toThrow(NotFoundException);
      await expect(service.findVisible(COMPANY, CASHIER_READER, 'sale-1')).rejects.toThrow(
        'Venta sale-1 no encontrada',
      );
    });

    it.each([
      ['whoever sees every sale', ADMIN_READER],
      ['whoever approves discounts or returns', APPROVER_READER],
    ])('lets %s read a sale of anyone', async (_who, actor) => {
      const { service, saleRepo } = createService();
      saleRepo.findOneBy.mockResolvedValue(draft({ cashierId: 'cashier-9', sellerId: 'seller-9' }));

      await expect(service.findVisible(COMPANY, actor, 'sale-1')).resolves.toMatchObject({ id: 'sale-1' });
    });

    it('does not reach a sale of another company, whoever asks', async () => {
      const { service, saleRepo } = createService();
      saleRepo.findOneBy.mockResolvedValue(null);

      await expect(service.findVisible(COMPANY, ADMIN_READER, 'sale-9')).rejects.toThrow(NotFoundException);
      expect(saleRepo.findOneBy).toHaveBeenCalledWith({ id: 'sale-9', companyId: COMPANY });
    });
  });

  describe('findItems', () => {
    it('lists the lines in the order they were added, after checking the sale is of the company', async () => {
      const { service, saleRepo, saleItemRepo } = createService();
      saleRepo.findOneBy.mockResolvedValue(draft());

      await service.findItems(COMPANY, CASHIER_READER, 'sale-1');

      expect(saleRepo.findOneBy).toHaveBeenCalledWith({ id: 'sale-1', companyId: COMPANY });
      expect(saleItemRepo.find).toHaveBeenCalledWith({
        where: { saleId: 'sale-1' },
        order: { createdAt: 'ASC' },
      });
    });

    it('does not reveal the lines of a sale of another company', async () => {
      const { service, saleRepo, saleItemRepo } = createService();
      saleRepo.findOneBy.mockResolvedValue(null);

      await expect(service.findItems(COMPANY, CASHIER_READER, 'sale-9')).rejects.toThrow(NotFoundException);
      expect(saleItemRepo.find).not.toHaveBeenCalled();
    });

    it('does not reveal the lines of a sale of another cashier to someone who cannot read it', async () => {
      const { service, saleRepo, saleItemRepo } = createService();
      saleRepo.findOneBy.mockResolvedValue(draft({ cashierId: 'cashier-9' }));

      await expect(service.findItems(COMPANY, CASHIER_READER, 'sale-1')).rejects.toThrow(NotFoundException);
      expect(saleItemRepo.find).not.toHaveBeenCalled();
    });

    it('lets whoever sees every sale read the lines of a sale of another cashier', async () => {
      const { service, saleRepo, saleItemRepo } = createService();
      saleRepo.findOneBy.mockResolvedValue(draft({ cashierId: 'cashier-9' }));

      await service.findItems(COMPANY, ADMIN_READER, 'sale-1');

      expect(saleItemRepo.find).toHaveBeenCalledWith({
        where: { saleId: 'sale-1' },
        order: { createdAt: 'ASC' },
      });
    });
  });

  describe('create', () => {
    it('creates a draft with zero totals, the session user as cashier and no number yet', async () => {
      const { service, txSaleRepo, dataSource } = createService();

      const sale = await service.create(COMPANY, CASHIER_ACTOR, input);

      expect(dataSource.transaction).toHaveBeenCalledTimes(1);
      expect(txSaleRepo.create).toHaveBeenCalledWith({
        companyId: COMPANY,
        storeId: 'store-1',
        sellerId: null,
        cashierId: CASHIER,
        cashSessionId: 'session-1',
        saleNumber: null,
        subtotal: new Decimal(0),
        discountTotal: new Decimal(0),
        generalDiscount: new Decimal(0),
        total: new Decimal(0),
        status: SaleStatus.DRAFT,
      });
      expect(sale.id).toBe('sale-1');
    });

    it('does not spend a consecutive number: the number is given when the sale is charged', async () => {
      const { service, sequences } = createService();

      const sale = await service.create(COMPANY, CASHIER_ACTOR, input);

      expect(sequences.next).not.toHaveBeenCalled();
      expect(sale.saleNumber).toBeNull();
    });

    it('locks the session as an open one assigned to the cashier who creates the sale', async () => {
      const { service, cashSessions } = createService();

      await service.create(COMPANY, CASHIER_ACTOR, input);

      expect(cashSessions.lockOpen).toHaveBeenCalledWith(expect.anything(), COMPANY, 'session-1', CASHIER_ACTOR);
    });

    it('rejects a session whose register is of another store', async () => {
      const { service, cashSessions, txSaleRepo } = createService();
      cashSessions.lockOpen.mockResolvedValue({ id: 'session-1', cashRegister: { storeId: 'store-9' } });

      await expect(service.create(COMPANY, CASHIER_ACTOR, input)).rejects.toThrow(
        'El turno es de una caja de otra tienda',
      );
      expect(txSaleRepo.save).not.toHaveBeenCalled();
    });

    it('only sells from a store of the company', async () => {
      const { service, locationRepo, txSaleRepo } = createService();
      locationRepo.findOneBy.mockResolvedValue(null);

      await expect(service.create(COMPANY, CASHIER_ACTOR, input)).rejects.toThrow(NotFoundException);
      // La búsqueda no filtra por estado: hay que encontrar la tienda para poder distinguir
      // "no existe" de "está desactivada". El filtro por empresa sí se mantiene.
      expect(locationRepo.findOneBy).toHaveBeenCalledWith({
        id: 'store-1',
        companyId: COMPANY,
        type: LocationType.STORE,
      });
      expect(txSaleRepo.save).not.toHaveBeenCalled();
    });

    it('says a deactivated store is deactivated, instead of pretending it does not exist', async () => {
      const { service, locationRepo, txSaleRepo } = createService();
      locationRepo.findOneBy.mockResolvedValue({
        id: 'store-1',
        name: 'Tienda centro',
        status: RecordStatus.INACTIVE,
      });

      await expect(service.create(COMPANY, CASHIER_ACTOR, input)).rejects.toThrow(ConflictException);
      await expect(service.create(COMPANY, CASHIER_ACTOR, input)).rejects.toThrow(
        'La tienda Tienda centro está desactivada: no se puede vender en ella',
      );
      expect(txSaleRepo.save).not.toHaveBeenCalled();
    });

    it('does not let a cashier sell from a store they have no access to', async () => {
      const { service, accessRepo, txSaleRepo } = createService();
      accessRepo.existsBy.mockResolvedValue(false);

      await expect(service.create(COMPANY, CASHIER_ACTOR, input)).rejects.toThrow(ForbiddenException);
      expect(accessRepo.existsBy).toHaveBeenCalledWith({
        userId: CASHIER,
        locationId: 'store-1',
        status: RecordStatus.ACTIVE,
      });
      expect(txSaleRepo.save).not.toHaveBeenCalled();
    });

    it('records the seller when it is an active member of the company', async () => {
      const { service, membershipRepo, userRepo, txSaleRepo } = createService();

      await service.create(COMPANY, CASHIER_ACTOR, { ...input, sellerId: 'seller-1' });

      expect(membershipRepo.existsBy).toHaveBeenCalledWith({
        userId: 'seller-1',
        companyId: COMPANY,
        status: RecordStatus.ACTIVE,
      });
      expect(userRepo.existsBy).toHaveBeenCalledWith({ id: 'seller-1', status: RecordStatus.ACTIVE });
      expect(txSaleRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({ sellerId: 'seller-1' }),
      );
    });

    it('rejects a seller who is not part of the company', async () => {
      const { service, membershipRepo, txSaleRepo } = createService();
      membershipRepo.existsBy.mockResolvedValue(false);

      await expect(
        service.create(COMPANY, CASHIER_ACTOR, { ...input, sellerId: 'seller-9' }),
      ).rejects.toThrow(NotFoundException);
      expect(txSaleRepo.save).not.toHaveBeenCalled();
    });

    it('rejects a seller whose account is deactivated, even with an active membership', async () => {
      const { service, userRepo, txSaleRepo } = createService();
      userRepo.existsBy.mockResolvedValue(false);

      await expect(
        service.create(COMPANY, CASHIER_ACTOR, { ...input, sellerId: 'seller-inactive' }),
      ).rejects.toThrow(NotFoundException);
      expect(txSaleRepo.save).not.toHaveBeenCalled();
    });

    describe('with an idempotency key', () => {
      it('without a key, nothing is claimed: it works as it always did', async () => {
        const { service, query } = createService();

        await service.create(COMPANY, CASHIER_ACTOR, input);

        expect(query).not.toHaveBeenCalled();
      });

      it('claims the key inside the same transaction and remembers the sale it created', async () => {
        const { service, query, dataSource } = createService();

        await service.create(COMPANY, CASHIER_ACTOR, input, 'key-1');

        expect(dataSource.transaction).toHaveBeenCalledTimes(1);
        expect(query).toHaveBeenNthCalledWith(
          1,
          expect.stringContaining('INSERT INTO "idempotency_keys"'),
          [COMPANY, CASHIER, 'createSale', 'key-1', expect.any(String)],
        );
        expect(query).toHaveBeenNthCalledWith(
          2,
          expect.stringContaining('UPDATE "idempotency_keys"'),
          [expect.any(String), 'sale', 'sale-1'],
        );
      });

      it('repeating the same request gives back the sale already created and opens no other draft', async () => {
        const { service, txSaleRepo, cashSessions } = createService();

        const first = await service.create(COMPANY, CASHIER_ACTOR, input, 'key-1');
        const second = await service.create(COMPANY, CASHIER_ACTOR, input, 'key-1');

        expect(second.id).toBe(first.id);
        expect(txSaleRepo.findOneByOrFail).toHaveBeenCalledWith({ id: 'sale-1' });
        expect(txSaleRepo.save).toHaveBeenCalledTimes(1);
        // El reintento no vuelve a hacer el trabajo, ni siquiera a bloquear el turno
        expect(cashSessions.lockOpen).toHaveBeenCalledTimes(1);
      });

      it('refuses the same key with other data: it is not a retry, so it answers with a conflict', async () => {
        const { service, txSaleRepo } = createService();
        await service.create(COMPANY, CASHIER_ACTOR, input, 'key-1');

        await expect(
          service.create(COMPANY, CASHIER_ACTOR, { ...input, sellerId: 'seller-1' }, 'key-1'),
        ).rejects.toThrow(ConflictException);
        await expect(
          service.create(COMPANY, CASHIER_ACTOR, { ...input, sellerId: 'seller-1' }, 'key-1'),
        ).rejects.toThrow('otros datos');
        expect(txSaleRepo.save).toHaveBeenCalledTimes(1);
      });

      it('the key belongs to whoever sent it: another cashier with the same key opens their own sale', async () => {
        const { service, txSaleRepo } = createService();

        await service.create(COMPANY, CASHIER_ACTOR, input, 'key-1');
        await service.create(COMPANY, ANOTHER_CASHIER_ACTOR, input, 'key-1');

        expect(txSaleRepo.save).toHaveBeenCalledTimes(2);
      });

      it('the same key on another operation is not mixed up with it', async () => {
        const { service, txSaleRepo, txItemRepo } = createService();
        txSaleRepo.findOne.mockResolvedValue(draft());

        await service.create(COMPANY, CASHIER_ACTOR, input, 'key-1');
        await service.addItem(COMPANY, CASHIER_ACTOR, newItem, 'key-1');

        expect(txItemRepo.save).toHaveBeenCalledTimes(1);
      });
    });
  });

  // El consecutivo lo pide quien cobra (SalePaymentService), con el manager de su transacción y al final,
  // cuando todo lo demás ya se comprobó.
  describe('assignNumber', () => {
    it('gives the sale the next consecutive of the company, in the transaction of whoever charges it', async () => {
      const { service, sequences, manager } = createService();
      const sale = draft();

      await service.assignNumber(manager as never, COMPANY, sale as never);

      expect(sequences.next).toHaveBeenCalledWith(manager, COMPANY, SALE_SERIES);
      expect(sale.saleNumber).toBe('VTA-000007');
    });

    it('respects the number of a sale that already has one, and does not spend another', async () => {
      const { service, sequences, manager } = createService();
      // Una venta de antes de que los números se dieran al cobrar
      const sale = draft({ saleNumber: 'VTA-000125' });

      await service.assignNumber(manager as never, COMPANY, sale as never);

      expect(sequences.next).not.toHaveBeenCalled();
      expect(sale.saleNumber).toBe('VTA-000125');
    });

    it('called twice on the same sale, spends a single number', async () => {
      const { service, sequences, manager } = createService();
      const sale = draft();

      await service.assignNumber(manager as never, COMPANY, sale as never);
      await service.assignNumber(manager as never, COMPANY, sale as never);

      expect(sequences.next).toHaveBeenCalledTimes(1);
      expect(sale.saleNumber).toBe('VTA-000007');
    });
  });

  describe('addItem', () => {
    it('adds a generic line without discount, works out its total and recalculates the sale', async () => {
      const { service, txSaleRepo, txItemRepo } = createService();
      txSaleRepo.findOne.mockResolvedValue(draft());
      // Al recalcular, la base ya devuelve la línea recién guardada.
      txItemRepo.find.mockResolvedValue([line('100000')]);

      const sale = await service.addItem(COMPANY, CASHIER_ACTOR, newItem);

      const created = txItemRepo.create.mock.calls[0][0];
      expect(created).toMatchObject({
        saleId: 'sale-1',
        type: SaleItemType.GENERIC,
        productVariantId: null,
        description: 'Flete',
        sku: null,
      });
      expect(created.quantity.toFixed(2)).toBe('2.00');
      expect(created.unitPrice.toFixed(2)).toBe('50000.00');
      expect(created.discountAmount.toFixed(2)).toBe('0.00');
      expect(created.total.toFixed(2)).toBe('100000.00');

      expect(sale.subtotal.toFixed(2)).toBe('100000.00');
      expect(sale.discountTotal.toFixed(2)).toBe('0.00');
      expect(sale.total.toFixed(2)).toBe('100000.00');
    });

    it('rounds the value of the line to cents, half up', async () => {
      const { service, txSaleRepo, txItemRepo } = createService();
      txSaleRepo.findOne.mockResolvedValue(draft());

      // 1.5 × 9999.99 = 14999.985
      await service.addItem(COMPANY, CASHIER_ACTOR, { ...newItem, quantity: '1.5', unitPrice: '9999.99' });

      expect(txItemRepo.create.mock.calls[0][0].total.toFixed(2)).toBe('14999.99');
    });

    it('trims the text and turns a blank sku into no sku', async () => {
      const { service, txSaleRepo, txItemRepo } = createService();
      txSaleRepo.findOne.mockResolvedValue(draft());

      await service.addItem(COMPANY, CASHIER_ACTOR, { ...newItem, description: '  Flete  ', sku: '   ' });

      expect(txItemRepo.create.mock.calls[0][0]).toMatchObject({ description: 'Flete', sku: null });
    });

    it('keeps the sku when there is one', async () => {
      const { service, txSaleRepo, txItemRepo } = createService();
      txSaleRepo.findOne.mockResolvedValue(draft());

      await service.addItem(COMPANY, CASHIER_ACTOR, { ...newItem, sku: ' FLT-01 ' });

      expect(txItemRepo.create.mock.calls[0][0]).toMatchObject({ sku: 'FLT-01' });
    });

    it('rejects a blank description, before touching the database', async () => {
      const { service, dataSource } = createService();

      await expect(service.addItem(COMPANY, CASHIER_ACTOR, { ...newItem, description: '   ' })).rejects.toThrow(
        BadRequestException,
      );
      expect(dataSource.transaction).not.toHaveBeenCalled();
    });

    it('rejects a quantity of zero', async () => {
      const { service, dataSource } = createService();

      await expect(service.addItem(COMPANY, CASHIER_ACTOR, { ...newItem, quantity: '0.00' })).rejects.toThrow(
        BadRequestException,
      );
      expect(dataSource.transaction).not.toHaveBeenCalled();
    });

    it('rejects a line whose value does not fit the database', async () => {
      const { service, dataSource } = createService();

      // 10000000 × 100000 = 1e12, el primer valor que ya no cabe en numeric(14,2)
      await expect(
        service.addItem(COMPANY, CASHIER_ACTOR, { ...newItem, quantity: '10000000', unitPrice: '100000' }),
      ).rejects.toThrow(BadRequestException);
      expect(dataSource.transaction).not.toHaveBeenCalled();
    });

    it('still lets lines be added while a discount request is active', async () => {
      const { service, txSaleRepo, txRequestRepo, txItemRepo } = createService();
      txSaleRepo.findOne.mockResolvedValue(draft({ generalDiscount: d('10000') }));
      txRequestRepo.existsBy.mockResolvedValue(true);
      txItemRepo.find.mockResolvedValue([line('100000')]);

      await expect(service.addItem(COMPANY, CASHIER_ACTOR, newItem)).resolves.toMatchObject({ id: 'sale-1' });
    });

    it('locks the sale and only changes a draft', async () => {
      const { service, txSaleRepo, txItemRepo } = createService();
      txSaleRepo.findOne.mockResolvedValue(draft({ status: SaleStatus.COMPLETED }));

      await expect(service.addItem(COMPANY, CASHIER_ACTOR, newItem)).rejects.toThrow(ConflictException);
      expect(txSaleRepo.findOne).toHaveBeenCalledWith({
        where: { id: 'sale-1', companyId: COMPANY },
        lock: { mode: 'pessimistic_write' },
      });
      expect(txItemRepo.save).not.toHaveBeenCalled();
    });

    it('cannot reach a sale of another company', async () => {
      const { service, txSaleRepo, txItemRepo } = createService();
      txSaleRepo.findOne.mockResolvedValue(null);

      await expect(service.addItem(COMPANY, CASHIER_ACTOR, newItem)).rejects.toThrow(NotFoundException);
      expect(txItemRepo.save).not.toHaveBeenCalled();
    });

    it('only lets the cashier of the sale build it: the draft of another cashier is refused', async () => {
      const { service, txSaleRepo, txItemRepo, accessRepo } = createService();
      txSaleRepo.findOne.mockResolvedValue(draft({ cashierId: 'cashier-9' }));

      await expect(service.addItem(COMPANY, CASHIER_ACTOR, newItem)).rejects.toThrow(ForbiddenException);
      await expect(service.addItem(COMPANY, CASHIER_ACTOR, newItem)).rejects.toThrow(
        'Solo el cajero de la venta puede modificarla',
      );
      expect(accessRepo.existsBy).not.toHaveBeenCalled();
      expect(txItemRepo.save).not.toHaveBeenCalled();
    });

    describe('with an idempotency key', () => {
      it('without a key, nothing is claimed', async () => {
        const { service, txSaleRepo, query } = createService();
        txSaleRepo.findOne.mockResolvedValue(draft());

        await service.addItem(COMPANY, CASHIER_ACTOR, newItem);

        expect(query).not.toHaveBeenCalled();
      });

      it('claims the key inside the transaction and remembers the sale the line was added to', async () => {
        const { service, txSaleRepo, query } = createService();
        txSaleRepo.findOne.mockResolvedValue(draft());

        await service.addItem(COMPANY, CASHIER_ACTOR, newItem, 'key-add');

        expect(query).toHaveBeenNthCalledWith(
          1,
          expect.stringContaining('INSERT INTO "idempotency_keys"'),
          [COMPANY, CASHIER, 'addSaleItem', 'key-add', expect.any(String)],
        );
        expect(query).toHaveBeenNthCalledWith(
          2,
          expect.stringContaining('UPDATE "idempotency_keys"'),
          [expect.any(String), 'sale', 'sale-1'],
        );
      });

      it('a retry with the same key gives back the sale and does not add the line twice', async () => {
        const { service, txSaleRepo, txItemRepo } = createService();
        txSaleRepo.findOne.mockResolvedValue(draft());

        const first = await service.addItem(COMPANY, CASHIER_ACTOR, newItem, 'key-add');
        const second = await service.addItem(COMPANY, CASHIER_ACTOR, newItem, 'key-add');

        expect(second.id).toBe(first.id);
        expect(txItemRepo.save).toHaveBeenCalledTimes(1);
        // El reintento ni siquiera bloquea la venta otra vez: la vuelve a cargar por su id
        expect(txSaleRepo.findOne).toHaveBeenCalledTimes(1);
        expect(txSaleRepo.findOneByOrFail).toHaveBeenCalledWith({ id: 'sale-1' });
      });

      it('refuses the same key with another line: it is not a retry, so it answers with a conflict', async () => {
        const { service, txSaleRepo, txItemRepo } = createService();
        txSaleRepo.findOne.mockResolvedValue(draft());
        await service.addItem(COMPANY, CASHIER_ACTOR, newItem, 'key-add');

        await expect(
          service.addItem(COMPANY, CASHIER_ACTOR, { ...newItem, quantity: '3' }, 'key-add'),
        ).rejects.toThrow(ConflictException);
        await expect(
          service.addItem(COMPANY, CASHIER_ACTOR, { ...newItem, quantity: '3' }, 'key-add'),
        ).rejects.toThrow('otros datos');
        expect(txItemRepo.save).toHaveBeenCalledTimes(1);
      });
    });
  });

  describe('updateItemQuantity', () => {
    // La línea tal como está guardada: 2 × 50000 = 100000, sin descuento.
    const storedItem = (overrides: Record<string, unknown> = {}) => ({
      id: 'item-1',
      saleId: 'sale-1',
      quantity: d('2'),
      unitPrice: d('50000'),
      discountAmount: d('0'),
      total: d('100000'),
      ...overrides,
    });
    const change = { saleId: 'sale-1', itemId: 'item-1', quantity: '3' };

    it('changes the quantity, works out the line total again and recalculates the sale', async () => {
      const { service, txSaleRepo, txItemRepo } = createService();
      txSaleRepo.findOne.mockResolvedValue(draft({ subtotal: d('100000'), total: d('100000') }));
      txItemRepo.findOneBy.mockResolvedValue(storedItem());
      // Al recalcular, la base ya devuelve la línea con su nueva cantidad.
      txItemRepo.find.mockResolvedValue([line('150000')]);

      const sale = await service.updateItemQuantity(COMPANY, CASHIER_ACTOR, change);

      expect(txItemRepo.findOneBy).toHaveBeenCalledWith({ id: 'item-1', saleId: 'sale-1' });
      const saved = txItemRepo.save.mock.calls[0][0];
      expect(saved.quantity.toFixed(2)).toBe('3.00');
      expect(saved.total.toFixed(2)).toBe('150000.00');
      // Solo cambia la cantidad: el precio se queda como estaba.
      expect(saved.unitPrice.toFixed(2)).toBe('50000.00');
      expect(sale.subtotal.toFixed(2)).toBe('150000.00');
      expect(sale.total.toFixed(2)).toBe('150000.00');
    });

    it('rounds the value of the line to cents, half up', async () => {
      const { service, txSaleRepo, txItemRepo } = createService();
      txSaleRepo.findOne.mockResolvedValue(draft());
      txItemRepo.findOneBy.mockResolvedValue(storedItem({ unitPrice: d('9999.99') }));

      // 1.5 × 9999.99 = 14999.985
      await service.updateItemQuantity(COMPANY, CASHIER_ACTOR, { ...change, quantity: '1.5' });

      expect(txItemRepo.save.mock.calls[0][0].total.toFixed(2)).toBe('14999.99');
    });

    it('does not change quantities while a discount request is active, so the amount never goes stale', async () => {
      const { service, txSaleRepo, txRequestRepo, txItemRepo } = createService();
      txSaleRepo.findOne.mockResolvedValue(draft());
      txRequestRepo.existsBy.mockResolvedValue(true);

      await expect(service.updateItemQuantity(COMPANY, CASHIER_ACTOR, change)).rejects.toThrow(ConflictException);
      expect(txRequestRepo.existsBy).toHaveBeenCalledWith({
        saleId: 'sale-1',
        status: In(ACTIVE_DISCOUNT_REQUEST_STATUSES),
      });
      expect(txItemRepo.save).not.toHaveBeenCalled();
    });

    it('rejects a quantity of zero, before touching the database', async () => {
      const { service, dataSource } = createService();

      await expect(
        service.updateItemQuantity(COMPANY, CASHIER_ACTOR, { ...change, quantity: '0.00' }),
      ).rejects.toThrow(BadRequestException);
      expect(dataSource.transaction).not.toHaveBeenCalled();
    });

    it('rejects a quantity that makes the line too big for the database', async () => {
      const { service, txSaleRepo, txItemRepo } = createService();
      txSaleRepo.findOne.mockResolvedValue(draft());
      txItemRepo.findOneBy.mockResolvedValue(storedItem({ unitPrice: d('100000') }));

      // 10000000 × 100000 = 1e12, el primer valor que ya no cabe en numeric(14,2)
      await expect(
        service.updateItemQuantity(COMPANY, CASHIER_ACTOR, { ...change, quantity: '10000000' }),
      ).rejects.toThrow(BadRequestException);
      expect(txItemRepo.save).not.toHaveBeenCalled();
    });

    it('cannot change a line that belongs to another sale', async () => {
      const { service, txSaleRepo, txItemRepo } = createService();
      txSaleRepo.findOne.mockResolvedValue(draft());
      txItemRepo.findOneBy.mockResolvedValue(null);

      await expect(
        service.updateItemQuantity(COMPANY, CASHIER_ACTOR, { ...change, itemId: 'item-9' }),
      ).rejects.toThrow(NotFoundException);
      expect(txItemRepo.save).not.toHaveBeenCalled();
    });

    it('locks the sale and only changes a draft', async () => {
      const { service, txSaleRepo, txItemRepo } = createService();
      txSaleRepo.findOne.mockResolvedValue(draft({ status: SaleStatus.COMPLETED }));

      await expect(service.updateItemQuantity(COMPANY, CASHIER_ACTOR, change)).rejects.toThrow(ConflictException);
      expect(txSaleRepo.findOne).toHaveBeenCalledWith({
        where: { id: 'sale-1', companyId: COMPANY },
        lock: { mode: 'pessimistic_write' },
      });
      expect(txItemRepo.save).not.toHaveBeenCalled();
    });

    it('cannot reach a sale of another company', async () => {
      const { service, txSaleRepo, txItemRepo } = createService();
      txSaleRepo.findOne.mockResolvedValue(null);

      await expect(service.updateItemQuantity(COMPANY, CASHIER_ACTOR, change)).rejects.toThrow(NotFoundException);
      expect(txItemRepo.save).not.toHaveBeenCalled();
    });
  });

  describe('removeItem', () => {
    it('removes the line and recalculates the sale', async () => {
      const { service, txSaleRepo, txItemRepo } = createService();
      txSaleRepo.findOne.mockResolvedValue(
        draft({ subtotal: d('100000'), discountTotal: d('0'), total: d('100000') }),
      );
      txItemRepo.findOneBy.mockResolvedValue({ id: 'item-1', saleId: 'sale-1' });
      txItemRepo.find.mockResolvedValue([]);

      const sale = await service.removeItem(COMPANY, CASHIER_ACTOR, 'sale-1', 'item-1');

      expect(txItemRepo.findOneBy).toHaveBeenCalledWith({ id: 'item-1', saleId: 'sale-1' });
      expect(txItemRepo.delete).toHaveBeenCalledWith('item-1');
      expect(sale.subtotal.toFixed(2)).toBe('0.00');
      expect(sale.total.toFixed(2)).toBe('0.00');
    });

    it('does not remove lines while a discount request is active, so the amount never goes stale', async () => {
      const { service, txSaleRepo, txRequestRepo, txItemRepo } = createService();
      txSaleRepo.findOne.mockResolvedValue(draft());
      txRequestRepo.existsBy.mockResolvedValue(true);

      await expect(service.removeItem(COMPANY, CASHIER_ACTOR, 'sale-1', 'item-1')).rejects.toThrow(
        ConflictException,
      );
      expect(txRequestRepo.existsBy).toHaveBeenCalledWith({
        saleId: 'sale-1',
        status: In(ACTIVE_DISCOUNT_REQUEST_STATUSES),
      });
      expect(txItemRepo.delete).not.toHaveBeenCalled();
    });

    it('cannot remove a line that belongs to another sale', async () => {
      const { service, txSaleRepo, txItemRepo } = createService();
      txSaleRepo.findOne.mockResolvedValue(draft());
      txItemRepo.findOneBy.mockResolvedValue(null);

      await expect(service.removeItem(COMPANY, CASHIER_ACTOR, 'sale-1', 'item-9')).rejects.toThrow(
        NotFoundException,
      );
      expect(txItemRepo.delete).not.toHaveBeenCalled();
    });

    it('only changes a draft', async () => {
      const { service, txSaleRepo, txItemRepo } = createService();
      txSaleRepo.findOne.mockResolvedValue(draft({ status: SaleStatus.CANCELLED }));

      await expect(service.removeItem(COMPANY, CASHIER_ACTOR, 'sale-1', 'item-1')).rejects.toThrow(
        ConflictException,
      );
      expect(txItemRepo.delete).not.toHaveBeenCalled();
    });
  });

  // Cambiar las líneas de una venta es cosa de su cajero, y además operar en su tienda: hace falta seguir
  // teniendo acceso a ella (no basta con haberlo tenido al crear la venta). Nadie está exento: ni el
  // administrador que abre y cierra turnos toca la venta de otro cajero ni opera una tienda sin asignar.
  describe('who can change the lines of a sale', () => {
    const ADMIN_ACTOR: CashActor = { userId: 'admin-1', canViewAll: true, canManageShifts: true };
    const storedItem = {
      id: 'item-1',
      saleId: 'sale-1',
      quantity: d('2'),
      unitPrice: d('50000'),
      discountAmount: d('0'),
      total: d('100000'),
    };

    const changes: [string, (service: SaleService, actor: CashActor) => Promise<unknown>][] = [
      ['add a line', (service, actor) => service.addItem(COMPANY, actor, newItem)],
      [
        'change the quantity of a line',
        (service, actor) =>
          service.updateItemQuantity(COMPANY, actor, { saleId: 'sale-1', itemId: 'item-1', quantity: '3' }),
      ],
      ['remove a line', (service, actor) => service.removeItem(COMPANY, actor, 'sale-1', 'item-1')],
    ];

    it.each(changes)('does not let a cashier without access to the store %s', async (_name, change) => {
      const { service, txSaleRepo, txItemRepo, accessRepo } = createService();
      txSaleRepo.findOne.mockResolvedValue(draft());
      accessRepo.existsBy.mockResolvedValue(false);

      await expect(change(service, CASHIER_ACTOR)).rejects.toThrow(ForbiddenException);
      expect(accessRepo.existsBy).toHaveBeenCalledWith({
        userId: CASHIER,
        locationId: 'store-1',
        status: RecordStatus.ACTIVE,
      });
      expect(txItemRepo.save).not.toHaveBeenCalled();
      expect(txItemRepo.delete).not.toHaveBeenCalled();
    });

    it.each(changes)(
      'does not let anyone but the cashier of the sale %s, not even whoever opens and closes shifts',
      async (_name, change) => {
        const { service, txSaleRepo, txItemRepo, accessRepo } = createService();
        // La venta es de CASHIER; quien la toca es el administrador
        txSaleRepo.findOne.mockResolvedValue(draft());
        txItemRepo.findOneBy.mockResolvedValue(storedItem);

        await expect(change(service, ADMIN_ACTOR)).rejects.toThrow('Solo el cajero de la venta puede modificarla');
        // Se niega antes de mirar el acceso a la tienda, y no se cambia nada
        expect(accessRepo.existsBy).not.toHaveBeenCalled();
        expect(txItemRepo.save).not.toHaveBeenCalled();
        expect(txItemRepo.delete).not.toHaveBeenCalled();
      },
    );

    it.each(changes)(
      'does not exempt whoever opens and closes shifts from having access to the store when they are the cashier of the sale: %s',
      async (_name, change) => {
        const { service, txSaleRepo, txItemRepo, accessRepo } = createService();
        txSaleRepo.findOne.mockResolvedValue(draft({ cashierId: 'admin-1' }));
        txItemRepo.findOneBy.mockResolvedValue(storedItem);
        accessRepo.existsBy.mockResolvedValue(false);

        await expect(change(service, ADMIN_ACTOR)).rejects.toThrow('No tienes acceso a esta tienda');
        expect(accessRepo.existsBy).toHaveBeenCalledWith({
          userId: 'admin-1',
          locationId: 'store-1',
          status: RecordStatus.ACTIVE,
        });
        expect(txItemRepo.save).not.toHaveBeenCalled();
        expect(txItemRepo.delete).not.toHaveBeenCalled();
      },
    );

    it.each(changes)('lets the cashier of the sale, with access to its store, %s', async (_name, change) => {
      const { service, txSaleRepo, txItemRepo, accessRepo } = createService();
      txSaleRepo.findOne.mockResolvedValue(draft());
      txItemRepo.findOneBy.mockResolvedValue(storedItem);

      await expect(change(service, CASHIER_ACTOR)).resolves.toMatchObject({ id: 'sale-1' });
      expect(accessRepo.existsBy).toHaveBeenCalledWith({
        userId: CASHIER,
        locationId: 'store-1',
        status: RecordStatus.ACTIVE,
      });
    });
  });

  describe('lockCompleted', () => {
    const managerOf = (txSaleRepo: object) => ({ getRepository: () => txSaleRepo });

    it('brings the completed sale locked, without changing it', async () => {
      const { service, txSaleRepo } = createService();
      txSaleRepo.findOne.mockResolvedValue(draft({ status: SaleStatus.COMPLETED }));

      const sale = await service.lockCompleted(managerOf(txSaleRepo) as never, COMPANY, 'sale-1');

      expect(txSaleRepo.findOne).toHaveBeenCalledWith({
        where: { id: 'sale-1', companyId: COMPANY },
        lock: { mode: 'pessimistic_write' },
      });
      expect(sale.status).toBe(SaleStatus.COMPLETED);
      expect(txSaleRepo.save).not.toHaveBeenCalled();
    });

    it.each([SaleStatus.DRAFT, SaleStatus.CANCELLED])(
      'only works on a completed sale, not on one that is %s',
      async (status) => {
        const { service, txSaleRepo } = createService();
        txSaleRepo.findOne.mockResolvedValue(draft({ status }));

        await expect(
          service.lockCompleted(managerOf(txSaleRepo) as never, COMPANY, 'sale-1'),
        ).rejects.toThrow(ConflictException);
      },
    );

    it('cannot reach a sale of another company', async () => {
      const { service, txSaleRepo } = createService();
      txSaleRepo.findOne.mockResolvedValue(null);

      await expect(
        service.lockCompleted(managerOf(txSaleRepo) as never, COMPANY, 'sale-9'),
      ).rejects.toThrow(NotFoundException);
    });
  });

  // Para cobrar: hay que distinguir el reintento de una venta ya cobrada de una cancelada, así que
  // trae la venta bloqueada sea cual sea su estado.
  describe('lockAnyStatus', () => {
    const managerOf = (txSaleRepo: object) => ({ getRepository: () => txSaleRepo });

    it.each([SaleStatus.DRAFT, SaleStatus.COMPLETED, SaleStatus.CANCELLED])(
      'brings the sale locked and untouched when it is %s',
      async (status) => {
        const { service, txSaleRepo } = createService();
        txSaleRepo.findOne.mockResolvedValue(draft({ status }));

        const sale = await service.lockAnyStatus(managerOf(txSaleRepo) as never, COMPANY, 'sale-1');

        expect(txSaleRepo.findOne).toHaveBeenCalledWith({
          where: { id: 'sale-1', companyId: COMPANY },
          lock: { mode: 'pessimistic_write' },
        });
        expect(sale.status).toBe(status);
        expect(txSaleRepo.save).not.toHaveBeenCalled();
      },
    );

    it('cannot reach a sale of another company', async () => {
      const { service, txSaleRepo } = createService();
      txSaleRepo.findOne.mockResolvedValue(null);

      await expect(
        service.lockAnyStatus(managerOf(txSaleRepo) as never, COMPANY, 'sale-9'),
      ).rejects.toThrow(NotFoundException);
    });
  });

  describe('cancel', () => {
    it('leaves who cancelled it, when and why', async () => {
      const { service, txSaleRepo } = createService();
      txSaleRepo.findOne.mockResolvedValue(draft());

      const sale = await service.cancel(COMPANY, ADMIN_CANCEL, 'sale-1', { reason: '  Cliente se arrepintió ' });

      expect(sale.status).toBe(SaleStatus.CANCELLED);
      expect(sale.cancelledBy).toBe('admin-1');
      expect(sale.cancelledAt).toBeInstanceOf(Date);
      expect(sale.cancellationReason).toBe('Cliente se arrepintió');
    });

    it('withdraws its active discount request with it, so it does not stay pending forever', async () => {
      const { service, txSaleRepo, txRequestRepo } = createService();
      txSaleRepo.findOne.mockResolvedValue(draft());
      txRequestRepo.find.mockResolvedValue([{ id: 'req-1', saleId: 'sale-1', status: DiscountRequestStatus.PENDING }]);

      await service.cancel(COMPANY, ADMIN_CANCEL, 'sale-1', { reason: 'X' });

      // Busca las activas (pendiente o aprobada) de esa venta y las cancela por su id
      expect(txRequestRepo.find).toHaveBeenCalledWith({
        where: { saleId: In(['sale-1']), status: In(ACTIVE_DISCOUNT_REQUEST_STATUSES) },
      });
      expect(txRequestRepo.update).toHaveBeenCalledWith(
        { id: In(['req-1']) },
        expect.objectContaining({
          status: DiscountRequestStatus.CANCELLED,
          resolvedBy: 'admin-1',
          resolutionNotes: 'Venta cancelada',
        }),
      );
    });

    it('tells whoever was looking at the pending request: the notice is read and their screen refreshes', async () => {
      const { service, txSaleRepo, txRequestRepo, notifications } = createService();
      txSaleRepo.findOne.mockResolvedValue(draft());
      txRequestRepo.find.mockResolvedValue([{ id: 'req-1', saleId: 'sale-1', status: DiscountRequestStatus.PENDING }]);

      await service.cancel(COMPANY, ADMIN_CANCEL, 'sale-1', { reason: 'X' });

      expect(notifications.findUserIdsWithPermission).toHaveBeenCalledWith(
        expect.anything(),
        COMPANY,
        PermissionCode.SALES_APPROVE_DISCOUNT,
      );
      expect(notifications.markEntityRead).toHaveBeenCalledWith(
        expect.anything(),
        NotificationEntityType.DISCOUNT_REQUEST,
        'req-1',
        [NotificationType.DISCOUNT_REQUESTED],
      );
      // A quien canceló no se le manda la señal: su pantalla ya se refresca con su propia operación
      expect(notifications.signalChange).toHaveBeenCalledWith(expect.anything(), {
        companyId: COMPANY,
        channel: NotificationChannel.DISCOUNTS,
        entityType: NotificationEntityType.DISCOUNT_REQUEST,
        entityId: 'req-1',
        recipientIds: ['admin-1', 'admin-2'],
        exceptUserId: 'admin-1',
      });
    });

    it('withdraws an approved request too, which has no new-request notice left to clear', async () => {
      const { service, txSaleRepo, txRequestRepo, notifications } = createService();
      txSaleRepo.findOne.mockResolvedValue(draft());
      txRequestRepo.find.mockResolvedValue([{ id: 'req-1', saleId: 'sale-1', status: DiscountRequestStatus.APPROVED }]);

      await service.cancel(COMPANY, ADMIN_CANCEL, 'sale-1', { reason: 'X' });

      expect(txRequestRepo.update).toHaveBeenCalledWith(
        { id: In(['req-1']) },
        expect.objectContaining({ status: DiscountRequestStatus.CANCELLED }),
      );
      expect(notifications.markEntityRead).not.toHaveBeenCalled();
      expect(notifications.signalChange).toHaveBeenCalledTimes(1);
    });

    it('with no active request there is nothing to withdraw and nobody to tell', async () => {
      const { service, txSaleRepo, txRequestRepo, notifications } = createService();
      txSaleRepo.findOne.mockResolvedValue(draft());
      txRequestRepo.find.mockResolvedValue([]);

      await service.cancel(COMPANY, ADMIN_CANCEL, 'sale-1', { reason: 'X' });

      expect(txRequestRepo.update).not.toHaveBeenCalled();
      expect(notifications.findUserIdsWithPermission).not.toHaveBeenCalled();
      expect(notifications.signalChange).not.toHaveBeenCalled();
    });

    it('locks the sale so two cancellations at once do not overwrite each other', async () => {
      const { service, txSaleRepo } = createService();
      txSaleRepo.findOne.mockResolvedValue(draft());

      await service.cancel(COMPANY, ADMIN_CANCEL, 'sale-1', { reason: 'X' });

      expect(txSaleRepo.findOne).toHaveBeenCalledWith({
        where: { id: 'sale-1', companyId: COMPANY },
        lock: { mode: 'pessimistic_write' },
      });
    });

    it('without sales.cancel, only cancels a sale of their own', async () => {
      const { service, txSaleRepo } = createService();
      txSaleRepo.findOne.mockResolvedValue(draft({ cashierId: CASHIER }));

      const sale = await service.cancel(COMPANY, { userId: CASHIER, canCancelAny: false }, 'sale-1', {
        reason: 'Me equivoqué de cliente',
      });

      expect(sale.status).toBe(SaleStatus.CANCELLED);
      expect(sale.cancelledBy).toBe(CASHIER);
    });

    it('without sales.cancel, cannot cancel the sale of another cashier', async () => {
      const { service, txSaleRepo, txRequestRepo } = createService();
      txSaleRepo.findOne.mockResolvedValue(draft({ cashierId: 'cashier-9' }));

      await expect(
        service.cancel(COMPANY, { userId: CASHIER, canCancelAny: false }, 'sale-1', { reason: 'X' }),
      ).rejects.toThrow(ForbiddenException);
      expect(txSaleRepo.save).not.toHaveBeenCalled();
      expect(txRequestRepo.update).not.toHaveBeenCalled();
    });

    it('cannot reach a sale of another company', async () => {
      const { service, txSaleRepo, txRequestRepo } = createService();
      txSaleRepo.findOne.mockResolvedValue(null);

      await expect(service.cancel(COMPANY, ADMIN_CANCEL, 'sale-9', { reason: 'X' })).rejects.toThrow(
        NotFoundException,
      );
      expect(txSaleRepo.save).not.toHaveBeenCalled();
      expect(txRequestRepo.update).not.toHaveBeenCalled();
    });

    it('does not cancel a sale twice', async () => {
      const { service, txSaleRepo, txRequestRepo } = createService();
      txSaleRepo.findOne.mockResolvedValue(draft({ status: SaleStatus.CANCELLED }));

      await expect(service.cancel(COMPANY, ADMIN_CANCEL, 'sale-1', { reason: 'X' })).rejects.toThrow(
        ConflictException,
      );
      expect(txSaleRepo.save).not.toHaveBeenCalled();
      expect(txRequestRepo.update).not.toHaveBeenCalled();
    });

    it('does not cancel a completed sale: it was already paid', async () => {
      const { service, txSaleRepo, txRequestRepo } = createService();
      txSaleRepo.findOne.mockResolvedValue(draft({ status: SaleStatus.COMPLETED }));

      await expect(service.cancel(COMPANY, ADMIN_CANCEL, 'sale-1', { reason: 'X' })).rejects.toThrow(
        ConflictException,
      );
      expect(txSaleRepo.save).not.toHaveBeenCalled();
      expect(txRequestRepo.update).not.toHaveBeenCalled();
    });

    it('asks for a reason that is not just blank spaces, before touching the database', async () => {
      const { service, dataSource } = createService();

      await expect(service.cancel(COMPANY, ADMIN_CANCEL, 'sale-1', { reason: '   ' })).rejects.toThrow(
        BadRequestException,
      );
      expect(dataSource.transaction).not.toHaveBeenCalled();
    });
  });
});
