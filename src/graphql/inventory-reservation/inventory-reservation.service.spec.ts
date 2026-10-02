import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import { Decimal } from 'decimal.js';
import { InventoryBalance } from '../inventory-balance/entities/inventory-balance.entity.js';
import { InventorySide } from '../inventory-balance/entities/inventory-side.enum.js';
import { InventoryLocation } from '../inventory-location/entities/inventory-location.entity.js';
import { IdempotencyKey } from '../idempotency/entities/idempotency-key.entity.js';
import { fingerprintOf } from '../idempotency/idempotency.js';
import { InventorySourceType } from '../inventory-movement/entities/inventory-source-type.enum.js';
import { ProductVariant } from '../product-variant/entities/product-variant.entity.js';
import { InventoryReservationService } from './inventory-reservation.service.js';

const claimKey = (sql: string) =>
  sql.includes('INSERT INTO "idempotency_keys"') ? [{ id: 'claim-1' }] : [];

function createService() {
  const repo = { find: vi.fn().mockResolvedValue([]), findOne: vi.fn(), delete: vi.fn() };
  const txReservationRepo = {
    create: vi.fn((value: unknown) => value),
    save: vi.fn(async (value: object) => ({ id: 'reservation-1', ...value })),
    findOneByOrFail: vi.fn(),
  };
  const variantRepo = { existsBy: vi.fn().mockResolvedValue(true) };
  const invLocationRepo = { existsBy: vi.fn().mockResolvedValue(true) };
  const balanceRepo = {
    findOne: vi.fn().mockResolvedValue({
      id: 'bal-1',
      productVariantId: 'variant-1',
      inventoryLocationId: 'inv-loc-1',
      side: InventorySide.PAIR,
      quantity: new Decimal('10'),
    }),
  };
  const idempotencyRepo = { findOneBy: vi.fn().mockResolvedValue(null) };
  // Por defecto nada reservado todavía; cada prueba de "ya hay reservas" lo ajusta.
  const queryMock = vi.fn(async (sql: string) =>
    sql.includes('idempotency_keys')
      ? claimKey(sql)
      : sql.includes('inventory_balances')
        ? []
        : [{ sum: '0' }],
  );
  const manager = {
    getRepository: (entity: unknown) =>
      entity === ProductVariant
        ? variantRepo
        : entity === InventoryLocation
          ? invLocationRepo
          : entity === InventoryBalance
            ? balanceRepo
            : entity === IdempotencyKey
              ? idempotencyRepo
              : txReservationRepo,
    query: queryMock,
  };
  const dataSource = {
    transaction: vi.fn(async (fn: (manager: unknown) => unknown) => fn(manager)),
  };
  const service = new InventoryReservationService(repo as never, dataSource as never);
  return {
    service,
    repo,
    txReservationRepo,
    variantRepo,
    invLocationRepo,
    balanceRepo,
    idempotencyRepo,
    manager,
    queryMock,
    dataSource,
  };
}

const COMPANY = 'company-1';
const USER = 'user-1';
const input = {
  productVariantId: 'variant-1',
  inventoryLocationId: 'inv-loc-1',
  side: InventorySide.PAIR,
  quantity: '4',
  sourceType: InventorySourceType.SALE,
  sourceId: 'sale-1',
};

describe('InventoryReservationService', () => {
  describe('findAll', () => {
    it('only lists reservations of variants that belong to the company', async () => {
      const { service, repo } = createService();

      await service.findAll(COMPANY);

      expect(repo.find).toHaveBeenCalledWith({
        where: { productVariant: { companyId: COMPANY } },
        order: { createdAt: 'ASC' },
      });
    });
  });

  describe('findOne', () => {
    it('cannot reach a reservation of a variant of another company', async () => {
      const { service, repo } = createService();
      repo.findOne.mockResolvedValue(null);

      await expect(service.findOne(COMPANY, 'missing')).rejects.toThrow(NotFoundException);
    });
  });

  describe('create', () => {
    it('rejects a quantity of zero, before touching the database', async () => {
      const { service, dataSource } = createService();

      await expect(service.create(COMPANY, USER, { ...input, quantity: '0' })).rejects.toThrow(
        BadRequestException,
      );
      expect(dataSource.transaction).not.toHaveBeenCalled();
    });

    it('reserves the amount when it fits in what is available', async () => {
      const { service, txReservationRepo } = createService();

      const reservation = await service.create(COMPANY, USER, input);

      expect(txReservationRepo.create).toHaveBeenCalledWith({
        productVariantId: 'variant-1',
        inventoryLocationId: 'inv-loc-1',
        side: InventorySide.PAIR,
        quantity: expect.any(Decimal),
        sourceType: InventorySourceType.SALE,
        sourceId: 'sale-1',
        sourceNumber: null,
      });
      expect(txReservationRepo.create.mock.calls[0][0].quantity.toFixed(2)).toBe('4.00');
      expect(reservation.id).toBe('reservation-1');
    });

    it('discounts what is already reserved before deciding if it fits', async () => {
      const { service, queryMock, txReservationRepo } = createService();
      queryMock.mockImplementation(async (sql: string) =>
        sql.includes('idempotency_keys')
          ? []
          : sql.includes('inventory_balances')
            ? []
            : [{ sum: '7' }],
      );

      // Balanza de 10, ya reservados 7: quedan 3 disponibles, alcanza para pedir 3 pero no para 4.
      await expect(service.create(COMPANY, USER, { ...input, quantity: '3' })).resolves.toBeDefined();
      await expect(service.create(COMPANY, USER, { ...input, quantity: '4' })).rejects.toThrow(
        ConflictException,
      );
      expect(txReservationRepo.save).toHaveBeenCalledTimes(1);
    });

    it('rejects when the balance itself does not have enough, even with nothing else reserved', async () => {
      const { service, balanceRepo, txReservationRepo } = createService();
      balanceRepo.findOne.mockResolvedValue({
        id: 'bal-1',
        productVariantId: 'variant-1',
        inventoryLocationId: 'inv-loc-1',
        side: InventorySide.PAIR,
        quantity: new Decimal('2'),
      });

      await expect(service.create(COMPANY, USER, { ...input, quantity: '3' })).rejects.toThrow(
        ConflictException,
      );
      expect(txReservationRepo.save).not.toHaveBeenCalled();
    });

    it('rejects a variant of another company', async () => {
      const { service, variantRepo, txReservationRepo } = createService();
      variantRepo.existsBy.mockResolvedValue(false);

      await expect(service.create(COMPANY, USER, input)).rejects.toThrow(NotFoundException);
      expect(txReservationRepo.save).not.toHaveBeenCalled();
    });

    it('rejects an inventory location of another company', async () => {
      const { service, invLocationRepo, txReservationRepo } = createService();
      invLocationRepo.existsBy.mockResolvedValue(false);

      await expect(service.create(COMPANY, USER, input)).rejects.toThrow(NotFoundException);
      expect(txReservationRepo.save).not.toHaveBeenCalled();
    });

    describe('with an idempotency key', () => {
      it('claims the key in the same transaction as the reservation, before saving anything', async () => {
        const { service, manager, dataSource, txReservationRepo } = createService();

        await service.create(COMPANY, USER, input, 'key-1');

        expect(dataSource.transaction).toHaveBeenCalledTimes(1);
        expect(manager.query).toHaveBeenNthCalledWith(
          1,
          expect.stringContaining('INSERT INTO "idempotency_keys"'),
          [COMPANY, USER, 'createInventoryReservation', 'key-1', fingerprintOf(input)],
        );
        expect(manager.query.mock.invocationCallOrder[0]).toBeLessThan(
          txReservationRepo.save.mock.invocationCallOrder[0],
        );
      });

      it('a repeated request gets back the same reservation, without reserving twice', async () => {
        const { service, idempotencyRepo, txReservationRepo, balanceRepo } = createService();
        idempotencyRepo.findOneBy.mockResolvedValue({
          fingerprint: fingerprintOf(input),
          resourceId: 'reservation-1',
        });
        txReservationRepo.findOneByOrFail.mockResolvedValue({ id: 'reservation-1', ...input });

        const reservation = await service.create(COMPANY, USER, input, 'key-1');

        expect(reservation.id).toBe('reservation-1');
        expect(balanceRepo.findOne).not.toHaveBeenCalled();
        expect(txReservationRepo.save).not.toHaveBeenCalled();
      });
    });
  });

  describe('release', () => {
    it('deletes the reservation', async () => {
      const { service, repo } = createService();
      repo.findOne.mockResolvedValue({ id: 'reservation-1' });

      await service.release(COMPANY, 'reservation-1');

      expect(repo.delete).toHaveBeenCalledWith('reservation-1');
    });

    it('cannot release a reservation of a variant of another company', async () => {
      const { service, repo } = createService();
      repo.findOne.mockResolvedValue(null);

      await expect(service.release(COMPANY, 'missing')).rejects.toThrow(NotFoundException);
      expect(repo.delete).not.toHaveBeenCalled();
    });
  });
});
