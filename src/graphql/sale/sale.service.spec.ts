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
import {
  ACTIVE_DISCOUNT_REQUEST_STATUSES,
  DiscountRequestStatus,
} from '../discount-request/entities/discount-request-status.enum.js';
import { DiscountRequest } from '../discount-request/entities/discount-request.entity.js';
import { LocationType } from '../location/entities/location-type.enum.js';
import { Location } from '../location/entities/location.entity.js';
import { User } from '../user/entities/user.entity.js';
import { UserCompanyRole } from '../user-company-role/entities/user-company-role.entity.js';
import { UserLocationAccess } from '../user-location-access/entities/user-location-access.entity.js';
import { SaleItemType } from './entities/sale-item-type.enum.js';
import { SaleItem } from './entities/sale-item.entity.js';
import { SaleStatus } from './entities/sale-status.enum.js';
import { SALE_SERIES } from './sale-number.js';
import { SaleService } from './sale.service.js';

function createService() {
  const saleRepo = { find: vi.fn().mockResolvedValue([]), findOneBy: vi.fn() };
  const saleItemRepo = { find: vi.fn().mockResolvedValue([]) };
  const txSaleRepo = {
    create: vi.fn((value: unknown) => value),
    save: vi.fn(async (value: object) => ({ id: 'sale-1', ...value })),
    findOne: vi.fn(),
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
  const dataSource = {
    transaction: vi.fn(async (fn: (manager: unknown) => unknown) =>
      fn({
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
                      : txSaleRepo,
      }),
    ),
  };

  const service = new SaleService(
    saleRepo as never,
    saleItemRepo as never,
    dataSource as never,
    sequences as never,
    cashSessions as never,
  );
  return {
    service,
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
    dataSource,
  };
}

const COMPANY = 'company-1';
const CASHIER = 'cashier-1';
const CASHIER_ACTOR: CashActor = { userId: CASHIER, canViewAll: false, canManageShifts: false };
const input = { storeId: 'store-1', cashSessionId: 'session-1' };

const d = (value: string) => new Decimal(value);

// Una venta en borrador tal como la entrega la base de datos.
const draft = (overrides: Record<string, unknown> = {}) => ({
  id: 'sale-1',
  companyId: COMPANY,
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
    it('without sales.view_all, only lists the sales the actor cashiered or sold', async () => {
      const { service, saleRepo } = createService();

      await service.findAll(COMPANY, { userId: CASHIER, canViewAll: false });

      expect(saleRepo.find).toHaveBeenCalledWith({
        where: [
          { companyId: COMPANY, cashierId: CASHIER },
          { companyId: COMPANY, sellerId: CASHIER },
        ],
        order: { createdAt: 'DESC' },
      });
    });

    it('without sales.view_all, status and store narrow both branches', async () => {
      const { service, saleRepo } = createService();

      await service.findAll(
        COMPANY,
        { userId: CASHIER, canViewAll: false },
        { status: SaleStatus.DRAFT, storeId: 'store-1' },
      );

      expect(saleRepo.find).toHaveBeenCalledWith({
        where: [
          { companyId: COMPANY, status: SaleStatus.DRAFT, storeId: 'store-1', cashierId: CASHIER },
          { companyId: COMPANY, status: SaleStatus.DRAFT, storeId: 'store-1', sellerId: CASHIER },
        ],
        order: { createdAt: 'DESC' },
      });
    });

    it('with sales.view_all, lists every sale of the company', async () => {
      const { service, saleRepo } = createService();

      await service.findAll(COMPANY, { userId: 'admin-1', canViewAll: true });

      expect(saleRepo.find).toHaveBeenCalledWith({
        where: { companyId: COMPANY },
        order: { createdAt: 'DESC' },
      });
    });

    it('with sales.view_all, can narrow the list down to one cashier', async () => {
      const { service, saleRepo } = createService();

      await service.findAll(COMPANY, { userId: 'admin-1', canViewAll: true }, { cashierId: CASHIER });

      expect(saleRepo.find).toHaveBeenCalledWith({
        where: { companyId: COMPANY, cashierId: CASHIER },
        order: { createdAt: 'DESC' },
      });
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

  describe('findItems', () => {
    it('lists the lines in the order they were added, after checking the sale is of the company', async () => {
      const { service, saleRepo, saleItemRepo } = createService();
      saleRepo.findOneBy.mockResolvedValue(draft());

      await service.findItems(COMPANY, 'sale-1');

      expect(saleRepo.findOneBy).toHaveBeenCalledWith({ id: 'sale-1', companyId: COMPANY });
      expect(saleItemRepo.find).toHaveBeenCalledWith({
        where: { saleId: 'sale-1' },
        order: { createdAt: 'ASC' },
      });
    });

    it('does not reveal the lines of a sale of another company', async () => {
      const { service, saleRepo, saleItemRepo } = createService();
      saleRepo.findOneBy.mockResolvedValue(null);

      await expect(service.findItems(COMPANY, 'sale-9')).rejects.toThrow(NotFoundException);
      expect(saleItemRepo.find).not.toHaveBeenCalled();
    });
  });

  describe('create', () => {
    it('creates a draft with zero totals, the session user as cashier and the next number', async () => {
      const { service, txSaleRepo, dataSource } = createService();

      const sale = await service.create(COMPANY, CASHIER_ACTOR, input);

      expect(dataSource.transaction).toHaveBeenCalledTimes(1);
      expect(txSaleRepo.create).toHaveBeenCalledWith({
        companyId: COMPANY,
        storeId: 'store-1',
        sellerId: null,
        cashierId: CASHIER,
        cashSessionId: 'session-1',
        saleNumber: 'VTA-000007',
        subtotal: new Decimal(0),
        discountTotal: new Decimal(0),
        generalDiscount: new Decimal(0),
        total: new Decimal(0),
        status: SaleStatus.DRAFT,
      });
      expect(sale.id).toBe('sale-1');
    });

    it('locks the session as an open one assigned to the cashier who creates the sale', async () => {
      const { service, cashSessions } = createService();

      await service.create(COMPANY, CASHIER_ACTOR, input);

      expect(cashSessions.lockOpen).toHaveBeenCalledWith(expect.anything(), COMPANY, 'session-1', CASHIER_ACTOR);
    });

    it('rejects a session whose register is of another store', async () => {
      const { service, cashSessions, sequences, txSaleRepo } = createService();
      cashSessions.lockOpen.mockResolvedValue({ id: 'session-1', cashRegister: { storeId: 'store-9' } });

      await expect(service.create(COMPANY, CASHIER_ACTOR, input)).rejects.toThrow(
        'El turno es de una caja de otra tienda',
      );
      expect(sequences.next).not.toHaveBeenCalled();
      expect(txSaleRepo.save).not.toHaveBeenCalled();
    });

    it('asks for the number of the company, inside the same transaction', async () => {
      const { service, sequences } = createService();

      await service.create(COMPANY, CASHIER_ACTOR, input);

      expect(sequences.next).toHaveBeenCalledWith(expect.anything(), COMPANY, SALE_SERIES);
    });

    it('only sells from a store of the company', async () => {
      const { service, locationRepo, sequences, txSaleRepo } = createService();
      locationRepo.findOneBy.mockResolvedValue(null);

      await expect(service.create(COMPANY, CASHIER_ACTOR, input)).rejects.toThrow(NotFoundException);
      // La búsqueda no filtra por estado: hay que encontrar la tienda para poder distinguir
      // "no existe" de "está desactivada". El filtro por empresa sí se mantiene.
      expect(locationRepo.findOneBy).toHaveBeenCalledWith({
        id: 'store-1',
        companyId: COMPANY,
        type: LocationType.STORE,
      });
      // No se gasta un consecutivo ni se guarda nada.
      expect(sequences.next).not.toHaveBeenCalled();
      expect(txSaleRepo.save).not.toHaveBeenCalled();
    });

    it('says a deactivated store is deactivated, instead of pretending it does not exist', async () => {
      const { service, locationRepo, sequences, txSaleRepo } = createService();
      locationRepo.findOneBy.mockResolvedValue({
        id: 'store-1',
        name: 'Tienda centro',
        status: RecordStatus.INACTIVE,
      });

      await expect(service.create(COMPANY, CASHIER_ACTOR, input)).rejects.toThrow(ConflictException);
      await expect(service.create(COMPANY, CASHIER_ACTOR, input)).rejects.toThrow(
        'La tienda Tienda centro está desactivada: no se puede vender en ella',
      );
      expect(sequences.next).not.toHaveBeenCalled();
      expect(txSaleRepo.save).not.toHaveBeenCalled();
    });

    it('does not let a cashier sell from a store they have no access to', async () => {
      const { service, accessRepo, sequences, txSaleRepo } = createService();
      accessRepo.existsBy.mockResolvedValue(false);

      await expect(service.create(COMPANY, CASHIER_ACTOR, input)).rejects.toThrow(ForbiddenException);
      expect(accessRepo.existsBy).toHaveBeenCalledWith({
        userId: CASHIER,
        locationId: 'store-1',
        status: RecordStatus.ACTIVE,
      });
      expect(sequences.next).not.toHaveBeenCalled();
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
      const { service, membershipRepo, sequences, txSaleRepo } = createService();
      membershipRepo.existsBy.mockResolvedValue(false);

      await expect(
        service.create(COMPANY, CASHIER_ACTOR, { ...input, sellerId: 'seller-9' }),
      ).rejects.toThrow(NotFoundException);
      expect(sequences.next).not.toHaveBeenCalled();
      expect(txSaleRepo.save).not.toHaveBeenCalled();
    });

    it('rejects a seller whose account is deactivated, even with an active membership', async () => {
      const { service, userRepo, sequences, txSaleRepo } = createService();
      userRepo.existsBy.mockResolvedValue(false);

      await expect(
        service.create(COMPANY, CASHIER_ACTOR, { ...input, sellerId: 'seller-inactive' }),
      ).rejects.toThrow(NotFoundException);
      expect(sequences.next).not.toHaveBeenCalled();
      expect(txSaleRepo.save).not.toHaveBeenCalled();
    });
  });

  describe('addItem', () => {
    it('adds a generic line without discount, works out its total and recalculates the sale', async () => {
      const { service, txSaleRepo, txItemRepo } = createService();
      txSaleRepo.findOne.mockResolvedValue(draft());
      // Al recalcular, la base ya devuelve la línea recién guardada.
      txItemRepo.find.mockResolvedValue([line('100000')]);

      const sale = await service.addItem(COMPANY, newItem);

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
      await service.addItem(COMPANY, { ...newItem, quantity: '1.5', unitPrice: '9999.99' });

      expect(txItemRepo.create.mock.calls[0][0].total.toFixed(2)).toBe('14999.99');
    });

    it('trims the text and turns a blank sku into no sku', async () => {
      const { service, txSaleRepo, txItemRepo } = createService();
      txSaleRepo.findOne.mockResolvedValue(draft());

      await service.addItem(COMPANY, { ...newItem, description: '  Flete  ', sku: '   ' });

      expect(txItemRepo.create.mock.calls[0][0]).toMatchObject({ description: 'Flete', sku: null });
    });

    it('keeps the sku when there is one', async () => {
      const { service, txSaleRepo, txItemRepo } = createService();
      txSaleRepo.findOne.mockResolvedValue(draft());

      await service.addItem(COMPANY, { ...newItem, sku: ' FLT-01 ' });

      expect(txItemRepo.create.mock.calls[0][0]).toMatchObject({ sku: 'FLT-01' });
    });

    it('rejects a blank description, before touching the database', async () => {
      const { service, dataSource } = createService();

      await expect(service.addItem(COMPANY, { ...newItem, description: '   ' })).rejects.toThrow(
        BadRequestException,
      );
      expect(dataSource.transaction).not.toHaveBeenCalled();
    });

    it('rejects a quantity of zero', async () => {
      const { service, dataSource } = createService();

      await expect(service.addItem(COMPANY, { ...newItem, quantity: '0.00' })).rejects.toThrow(
        BadRequestException,
      );
      expect(dataSource.transaction).not.toHaveBeenCalled();
    });

    it('rejects a line whose value does not fit the database', async () => {
      const { service, dataSource } = createService();

      // 10000000 × 100000 = 1e12, el primer valor que ya no cabe en numeric(14,2)
      await expect(
        service.addItem(COMPANY, { ...newItem, quantity: '10000000', unitPrice: '100000' }),
      ).rejects.toThrow(BadRequestException);
      expect(dataSource.transaction).not.toHaveBeenCalled();
    });

    it('still lets lines be added while a discount request is active', async () => {
      const { service, txSaleRepo, txRequestRepo, txItemRepo } = createService();
      txSaleRepo.findOne.mockResolvedValue(draft({ generalDiscount: d('10000') }));
      txRequestRepo.existsBy.mockResolvedValue(true);
      txItemRepo.find.mockResolvedValue([line('100000')]);

      await expect(service.addItem(COMPANY, newItem)).resolves.toMatchObject({ id: 'sale-1' });
    });

    it('locks the sale and only changes a draft', async () => {
      const { service, txSaleRepo, txItemRepo } = createService();
      txSaleRepo.findOne.mockResolvedValue(draft({ status: SaleStatus.COMPLETED }));

      await expect(service.addItem(COMPANY, newItem)).rejects.toThrow(ConflictException);
      expect(txSaleRepo.findOne).toHaveBeenCalledWith({
        where: { id: 'sale-1', companyId: COMPANY },
        lock: { mode: 'pessimistic_write' },
      });
      expect(txItemRepo.save).not.toHaveBeenCalled();
    });

    it('cannot reach a sale of another company', async () => {
      const { service, txSaleRepo, txItemRepo } = createService();
      txSaleRepo.findOne.mockResolvedValue(null);

      await expect(service.addItem(COMPANY, newItem)).rejects.toThrow(NotFoundException);
      expect(txItemRepo.save).not.toHaveBeenCalled();
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

      const sale = await service.updateItemQuantity(COMPANY, change);

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
      await service.updateItemQuantity(COMPANY, { ...change, quantity: '1.5' });

      expect(txItemRepo.save.mock.calls[0][0].total.toFixed(2)).toBe('14999.99');
    });

    it('does not change quantities while a discount request is active, so the amount never goes stale', async () => {
      const { service, txSaleRepo, txRequestRepo, txItemRepo } = createService();
      txSaleRepo.findOne.mockResolvedValue(draft());
      txRequestRepo.existsBy.mockResolvedValue(true);

      await expect(service.updateItemQuantity(COMPANY, change)).rejects.toThrow(ConflictException);
      expect(txRequestRepo.existsBy).toHaveBeenCalledWith({
        saleId: 'sale-1',
        status: In(ACTIVE_DISCOUNT_REQUEST_STATUSES),
      });
      expect(txItemRepo.save).not.toHaveBeenCalled();
    });

    it('rejects a quantity of zero, before touching the database', async () => {
      const { service, dataSource } = createService();

      await expect(
        service.updateItemQuantity(COMPANY, { ...change, quantity: '0.00' }),
      ).rejects.toThrow(BadRequestException);
      expect(dataSource.transaction).not.toHaveBeenCalled();
    });

    it('rejects a quantity that makes the line too big for the database', async () => {
      const { service, txSaleRepo, txItemRepo } = createService();
      txSaleRepo.findOne.mockResolvedValue(draft());
      txItemRepo.findOneBy.mockResolvedValue(storedItem({ unitPrice: d('100000') }));

      // 10000000 × 100000 = 1e12, el primer valor que ya no cabe en numeric(14,2)
      await expect(
        service.updateItemQuantity(COMPANY, { ...change, quantity: '10000000' }),
      ).rejects.toThrow(BadRequestException);
      expect(txItemRepo.save).not.toHaveBeenCalled();
    });

    it('cannot change a line that belongs to another sale', async () => {
      const { service, txSaleRepo, txItemRepo } = createService();
      txSaleRepo.findOne.mockResolvedValue(draft());
      txItemRepo.findOneBy.mockResolvedValue(null);

      await expect(
        service.updateItemQuantity(COMPANY, { ...change, itemId: 'item-9' }),
      ).rejects.toThrow(NotFoundException);
      expect(txItemRepo.save).not.toHaveBeenCalled();
    });

    it('locks the sale and only changes a draft', async () => {
      const { service, txSaleRepo, txItemRepo } = createService();
      txSaleRepo.findOne.mockResolvedValue(draft({ status: SaleStatus.COMPLETED }));

      await expect(service.updateItemQuantity(COMPANY, change)).rejects.toThrow(ConflictException);
      expect(txSaleRepo.findOne).toHaveBeenCalledWith({
        where: { id: 'sale-1', companyId: COMPANY },
        lock: { mode: 'pessimistic_write' },
      });
      expect(txItemRepo.save).not.toHaveBeenCalled();
    });

    it('cannot reach a sale of another company', async () => {
      const { service, txSaleRepo, txItemRepo } = createService();
      txSaleRepo.findOne.mockResolvedValue(null);

      await expect(service.updateItemQuantity(COMPANY, change)).rejects.toThrow(NotFoundException);
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

      const sale = await service.removeItem(COMPANY, 'sale-1', 'item-1');

      expect(txItemRepo.findOneBy).toHaveBeenCalledWith({ id: 'item-1', saleId: 'sale-1' });
      expect(txItemRepo.delete).toHaveBeenCalledWith('item-1');
      expect(sale.subtotal.toFixed(2)).toBe('0.00');
      expect(sale.total.toFixed(2)).toBe('0.00');
    });

    it('does not remove lines while a discount request is active, so the amount never goes stale', async () => {
      const { service, txSaleRepo, txRequestRepo, txItemRepo } = createService();
      txSaleRepo.findOne.mockResolvedValue(draft());
      txRequestRepo.existsBy.mockResolvedValue(true);

      await expect(service.removeItem(COMPANY, 'sale-1', 'item-1')).rejects.toThrow(
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

      await expect(service.removeItem(COMPANY, 'sale-1', 'item-9')).rejects.toThrow(
        NotFoundException,
      );
      expect(txItemRepo.delete).not.toHaveBeenCalled();
    });

    it('only changes a draft', async () => {
      const { service, txSaleRepo, txItemRepo } = createService();
      txSaleRepo.findOne.mockResolvedValue(draft({ status: SaleStatus.CANCELLED }));

      await expect(service.removeItem(COMPANY, 'sale-1', 'item-1')).rejects.toThrow(
        ConflictException,
      );
      expect(txItemRepo.delete).not.toHaveBeenCalled();
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

  describe('cancel', () => {
    it('leaves who cancelled it, when and why', async () => {
      const { service, txSaleRepo } = createService();
      txSaleRepo.findOne.mockResolvedValue(draft());

      const sale = await service.cancel(COMPANY, { userId: 'admin-1', canCancelAny: true }, 'sale-1', { reason: '  Cliente se arrepintió ' });

      expect(sale.status).toBe(SaleStatus.CANCELLED);
      expect(sale.cancelledBy).toBe('admin-1');
      expect(sale.cancelledAt).toBeInstanceOf(Date);
      expect(sale.cancellationReason).toBe('Cliente se arrepintió');
    });

    it('cancels its active discount request with it, so it does not stay pending forever', async () => {
      const { service, txSaleRepo, txRequestRepo } = createService();
      txSaleRepo.findOne.mockResolvedValue(draft());

      await service.cancel(COMPANY, { userId: 'admin-1', canCancelAny: true }, 'sale-1', { reason: 'X' });

      expect(txRequestRepo.update).toHaveBeenCalledWith(
        { saleId: 'sale-1', status: In(ACTIVE_DISCOUNT_REQUEST_STATUSES) },
        expect.objectContaining({
          status: DiscountRequestStatus.CANCELLED,
          resolvedBy: 'admin-1',
          resolutionNotes: 'Venta cancelada',
        }),
      );
    });

    it('locks the sale so two cancellations at once do not overwrite each other', async () => {
      const { service, txSaleRepo } = createService();
      txSaleRepo.findOne.mockResolvedValue(draft());

      await service.cancel(COMPANY, { userId: 'admin-1', canCancelAny: true }, 'sale-1', { reason: 'X' });

      expect(txSaleRepo.findOne).toHaveBeenCalledWith({
        where: { id: 'sale-1', companyId: COMPANY },
        lock: { mode: 'pessimistic_write' },
      });
    });

    it('cannot reach a sale of another company', async () => {
      const { service, txSaleRepo, txRequestRepo } = createService();
      txSaleRepo.findOne.mockResolvedValue(null);

      await expect(service.cancel(COMPANY, { userId: 'admin-1', canCancelAny: true }, 'sale-9', { reason: 'X' })).rejects.toThrow(
        NotFoundException,
      );
      expect(txSaleRepo.save).not.toHaveBeenCalled();
      expect(txRequestRepo.update).not.toHaveBeenCalled();
    });

    it('does not cancel a sale twice', async () => {
      const { service, txSaleRepo } = createService();
      txSaleRepo.findOne.mockResolvedValue(draft({ status: SaleStatus.CANCELLED }));

      await expect(service.cancel(COMPANY, { userId: 'admin-1', canCancelAny: true }, 'sale-1', { reason: 'X' })).rejects.toThrow(
        ConflictException,
      );
      expect(txSaleRepo.save).not.toHaveBeenCalled();
    });

    it('does not cancel a completed sale: it was already paid', async () => {
      const { service, txSaleRepo, txRequestRepo } = createService();
      txSaleRepo.findOne.mockResolvedValue(draft({ status: SaleStatus.COMPLETED }));

      await expect(service.cancel(COMPANY, { userId: 'admin-1', canCancelAny: true }, 'sale-1', { reason: 'X' })).rejects.toThrow(
        ConflictException,
      );
      expect(txSaleRepo.save).not.toHaveBeenCalled();
      expect(txRequestRepo.update).not.toHaveBeenCalled();
    });

    it('asks for a reason that is not just blank spaces, before touching the database', async () => {
      const { service, dataSource } = createService();

      await expect(service.cancel(COMPANY, { userId: 'admin-1', canCancelAny: true }, 'sale-1', { reason: '   ' })).rejects.toThrow(
        BadRequestException,
      );
      expect(dataSource.transaction).not.toHaveBeenCalled();
    });
  });
});
