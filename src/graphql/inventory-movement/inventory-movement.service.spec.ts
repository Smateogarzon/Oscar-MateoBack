import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import { Decimal } from 'decimal.js';
import { InventoryBalance } from '../inventory-balance/entities/inventory-balance.entity.js';
import { InventorySide } from '../inventory-balance/entities/inventory-side.enum.js';
import { InventoryLocation } from '../inventory-location/entities/inventory-location.entity.js';
import { IdempotencyKey } from '../idempotency/entities/idempotency-key.entity.js';
import { fingerprintOf } from '../idempotency/idempotency.js';
import { ProductVariant } from '../product-variant/entities/product-variant.entity.js';
import { InventoryMovementType } from './entities/inventory-movement-type.enum.js';
import { InventorySourceType } from './entities/inventory-source-type.enum.js';
import { InventoryMovementService } from './inventory-movement.service.js';

const claimKey = (sql: string) =>
  sql.includes('INSERT INTO "idempotency_keys"') ? [{ id: 'claim-1' }] : [];

// Cómo entrega la balanza ya bloqueada (lockOrCreateBalance): siempre la misma variante y lado en
// estas pruebas, solo cambia la ubicación y lo que había.
const balance = (inventoryLocationId: string, quantity: string) => ({
  id: `bal-${inventoryLocationId}`,
  productVariantId: 'variant-1',
  inventoryLocationId,
  side: InventorySide.PAIR,
  quantity: new Decimal(quantity),
});

function createService() {
  const repo = { find: vi.fn().mockResolvedValue([]), findOneBy: vi.fn() };
  const txMovementRepo = {
    create: vi.fn((value: unknown) => value),
    save: vi.fn(async (value: object) => ({ id: 'movement-1', ...value })),
    findOneByOrFail: vi.fn(),
  };
  const variantRepo = { existsBy: vi.fn().mockResolvedValue(true) };
  const invLocationRepo = { existsBy: vi.fn().mockResolvedValue(true) };
  const balanceRepo = { findOne: vi.fn(), save: vi.fn(async (value: object) => value) };
  const idempotencyRepo = { findOneBy: vi.fn().mockResolvedValue(null) };
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
              : txMovementRepo,
    query: vi.fn(async (sql: string) => claimKey(sql)),
  };
  const dataSource = {
    transaction: vi.fn(async (fn: (manager: unknown) => unknown) => fn(manager)),
  };
  // Ninguna prueba de aquí pone `minStock` en una balanza: el aviso de existencia baja nunca se
  // dispara, así que basta con que el mock exista para completar la firma.
  const notifications = { findUserIdsWithPermission: vi.fn().mockResolvedValue([]), notify: vi.fn() };
  const service = new InventoryMovementService(repo as never, dataSource as never, notifications as never);
  return {
    service,
    repo,
    txMovementRepo,
    variantRepo,
    invLocationRepo,
    balanceRepo,
    idempotencyRepo,
    manager,
    dataSource,
  };
}

const COMPANY = 'company-1';
const USER = 'user-1';

const purchase = {
  productVariantId: 'variant-1',
  toLocationId: 'to-1',
  side: InventorySide.PAIR,
  quantity: '5',
  type: InventoryMovementType.PURCHASE,
  sourceType: InventorySourceType.PURCHASE_ORDER,
};

const sale = {
  productVariantId: 'variant-1',
  fromLocationId: 'from-1',
  side: InventorySide.PAIR,
  quantity: '3',
  type: InventoryMovementType.SALE,
  sourceType: InventorySourceType.SALE,
};

describe('InventoryMovementService', () => {
  describe('findAll', () => {
    it('only lists the movements of the company', async () => {
      const { service, repo } = createService();

      await service.findAll(COMPANY);

      expect(repo.find).toHaveBeenCalledWith({
        where: { companyId: COMPANY },
        order: { createdAt: 'DESC' },
      });
    });
  });

  describe('findOne', () => {
    it('looks it up inside the company', async () => {
      const { service, repo } = createService();
      repo.findOneBy.mockResolvedValue(null);

      await expect(service.findOne(COMPANY, 'missing')).rejects.toThrow(NotFoundException);
    });
  });

  describe('record', () => {
    it('rejects a movement with neither origin nor destination, before touching the database', async () => {
      const { service, dataSource } = createService();

      await expect(
        service.record(COMPANY, USER, { ...purchase, toLocationId: undefined }),
      ).rejects.toThrow(BadRequestException);
      expect(dataSource.transaction).not.toHaveBeenCalled();
    });

    it('rejects the same location as origin and destination, before touching the database', async () => {
      const { service, dataSource } = createService();

      await expect(
        service.record(COMPANY, USER, { ...sale, toLocationId: 'from-1' }),
      ).rejects.toThrow(BadRequestException);
      expect(dataSource.transaction).not.toHaveBeenCalled();
    });

    it('rejects a quantity of zero, before touching the database', async () => {
      const { service, dataSource } = createService();

      await expect(service.record(COMPANY, USER, { ...purchase, quantity: '0' })).rejects.toThrow(
        BadRequestException,
      );
      expect(dataSource.transaction).not.toHaveBeenCalled();
    });

    it('a purchase (destination only) creates the balance at zero and adds to it', async () => {
      const { service, balanceRepo, txMovementRepo } = createService();
      balanceRepo.findOne.mockResolvedValueOnce(balance('to-1', '0'));

      const movement = await service.record(COMPANY, USER, purchase);

      expect(balanceRepo.save).toHaveBeenCalledWith(expect.objectContaining({ inventoryLocationId: 'to-1' }));
      expect(balanceRepo.save.mock.calls[0][0].quantity.toFixed(2)).toBe('5.00');
      expect(txMovementRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({
          companyId: COMPANY,
          fromLocationId: null,
          toLocationId: 'to-1',
          createdBy: USER,
        }),
      );
      expect(movement.id).toBe('movement-1');
    });

    it('a sale (origin only) takes from the balance and never touches a destination', async () => {
      const { service, balanceRepo, txMovementRepo } = createService();
      balanceRepo.findOne.mockResolvedValueOnce(balance('from-1', '10'));

      await service.record(COMPANY, USER, sale);

      expect(balanceRepo.save.mock.calls[0][0].quantity.toFixed(2)).toBe('7.00');
      expect(txMovementRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({ fromLocationId: 'from-1', toLocationId: null }),
      );
    });

    it('rejects a sale when there is not enough balance, and creates no movement', async () => {
      const { service, balanceRepo, txMovementRepo } = createService();
      balanceRepo.findOne.mockResolvedValueOnce(balance('from-1', '2'));

      await expect(service.record(COMPANY, USER, { ...sale, quantity: '5' })).rejects.toThrow(
        ConflictException,
      );
      expect(balanceRepo.save).not.toHaveBeenCalled();
      expect(txMovementRepo.save).not.toHaveBeenCalled();
    });

    it('a transfer locks both balances in location-id order, regardless of which is origin and which is destination', async () => {
      const { service, balanceRepo } = createService();
      // 'loc-a' < 'loc-b': se bloquea primero 'loc-a' (el destino), aunque el origen es 'loc-b'.
      balanceRepo.findOne
        .mockResolvedValueOnce(balance('loc-a', '1'))
        .mockResolvedValueOnce(balance('loc-b', '10'));

      await service.record(COMPANY, USER, {
        ...sale,
        fromLocationId: 'loc-b',
        toLocationId: 'loc-a',
        quantity: '4',
      });

      expect(balanceRepo.findOne).toHaveBeenNthCalledWith(1, {
        where: { productVariantId: 'variant-1', inventoryLocationId: 'loc-a', side: InventorySide.PAIR },
        lock: { mode: 'pessimistic_write' },
      });
      expect(balanceRepo.findOne).toHaveBeenNthCalledWith(2, {
        where: { productVariantId: 'variant-1', inventoryLocationId: 'loc-b', side: InventorySide.PAIR },
        lock: { mode: 'pessimistic_write' },
      });
      // 'loc-b' (origen) resta, 'loc-a' (destino) suma, sin que el orden de bloqueo cambie cuál es cuál.
      const saved = balanceRepo.save.mock.calls.map((call) => call[0]);
      expect(saved.find((row) => row.inventoryLocationId === 'loc-b').quantity.toFixed(2)).toBe('6.00');
      expect(saved.find((row) => row.inventoryLocationId === 'loc-a').quantity.toFixed(2)).toBe('5.00');
    });

    it('rejects a variant of another company (or one that does not exist)', async () => {
      const { service, variantRepo, txMovementRepo } = createService();
      variantRepo.existsBy.mockResolvedValue(false);

      await expect(service.record(COMPANY, USER, purchase)).rejects.toThrow(NotFoundException);
      expect(txMovementRepo.save).not.toHaveBeenCalled();
    });

    it('rejects an origin inventory location of another company', async () => {
      const { service, invLocationRepo, txMovementRepo } = createService();
      invLocationRepo.existsBy.mockResolvedValue(false);

      await expect(service.record(COMPANY, USER, sale)).rejects.toThrow(NotFoundException);
      expect(txMovementRepo.save).not.toHaveBeenCalled();
    });

    it('rejects a destination inventory location of another company', async () => {
      const { service, invLocationRepo, txMovementRepo } = createService();
      invLocationRepo.existsBy.mockResolvedValue(false);

      await expect(service.record(COMPANY, USER, purchase)).rejects.toThrow(NotFoundException);
      expect(txMovementRepo.save).not.toHaveBeenCalled();
    });

    describe('with an idempotency key', () => {
      it('claims the key in the same transaction as the recording, before touching any balance', async () => {
        const { service, manager, dataSource, balanceRepo } = createService();
        balanceRepo.findOne.mockResolvedValueOnce(balance('to-1', '0'));

        await service.record(COMPANY, USER, purchase, 'key-1');

        expect(dataSource.transaction).toHaveBeenCalledTimes(1);
        expect(manager.query).toHaveBeenNthCalledWith(
          1,
          expect.stringContaining('INSERT INTO "idempotency_keys"'),
          [COMPANY, USER, 'recordInventoryMovement', 'key-1', fingerprintOf(purchase)],
        );
        expect(manager.query.mock.invocationCallOrder[0]).toBeLessThan(
          balanceRepo.save.mock.invocationCallOrder[0],
        );
      });

      it('a repeated request gets back the same movement, without touching a balance again', async () => {
        const { service, manager, idempotencyRepo, txMovementRepo, balanceRepo } = createService();
        manager.query = vi.fn(async () => []);
        idempotencyRepo.findOneBy.mockResolvedValue({
          fingerprint: fingerprintOf(purchase),
          resourceId: 'movement-1',
        });
        txMovementRepo.findOneByOrFail.mockResolvedValue({ id: 'movement-1', ...purchase });

        const movement = await service.record(COMPANY, USER, purchase, 'key-1');

        expect(movement.id).toBe('movement-1');
        expect(balanceRepo.findOne).not.toHaveBeenCalled();
        expect(balanceRepo.save).not.toHaveBeenCalled();
      });
    });
  });
});
