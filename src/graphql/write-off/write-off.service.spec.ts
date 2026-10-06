import { ConflictException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { Decimal } from 'decimal.js';
import { Incident } from '../incident/entities/incident.entity.js';
import { IdempotencyKey } from '../idempotency/entities/idempotency-key.entity.js';
import { fingerprintOf } from '../idempotency/idempotency.js';
import { InventoryMovementType } from '../inventory-movement/entities/inventory-movement-type.enum.js';
import { InventorySourceType } from '../inventory-movement/entities/inventory-source-type.enum.js';
import { Location } from '../location/entities/location.entity.js';
import { ProductVariant } from '../product-variant/entities/product-variant.entity.js';
import { WriteOffItem } from './entities/write-off-item.entity.js';
import { WriteOffStatus } from './entities/write-off-status.enum.js';
import { WriteOffService } from './write-off.service.js';

const claimKey = (sql: string) =>
  sql.includes('INSERT INTO "idempotency_keys"') ? [{ id: 'claim-1' }] : [];

function createService() {
  const repo = { find: vi.fn().mockResolvedValue([]), findOneBy: vi.fn() };
  const txWriteOffRepo = {
    create: vi.fn((value: unknown) => value),
    save: vi.fn(async (value: object) => ({ id: 'write-off-1', ...value })),
    findOne: vi.fn(),
    findOneByOrFail: vi.fn(),
  };
  const txItemRepo = {
    create: vi.fn((value: unknown) => value),
    save: vi.fn(async (value: unknown) => value),
    find: vi.fn().mockResolvedValue([]),
  };
  const locationRepo = { existsBy: vi.fn().mockResolvedValue(true) };
  const variantRepo = { existsBy: vi.fn().mockResolvedValue(true) };
  const incidentRepo = { existsBy: vi.fn().mockResolvedValue(true) };
  const idempotencyRepo = { findOneBy: vi.fn().mockResolvedValue(null) };
  const manager = {
    getRepository: (entity: unknown) =>
      entity === Location
        ? locationRepo
        : entity === ProductVariant
          ? variantRepo
          : entity === Incident
            ? incidentRepo
            : entity === WriteOffItem
              ? txItemRepo
              : entity === IdempotencyKey
                ? idempotencyRepo
                : txWriteOffRepo,
    query: vi.fn(async (sql: string) => claimKey(sql)),
  };
  const dataSource = {
    transaction: vi.fn(async (fn: (manager: unknown) => unknown) => fn(manager)),
    manager: { find: vi.fn().mockResolvedValue([]) },
  };
  const sequences = { next: vi.fn().mockResolvedValue(1) };
  const inventoryMovements = { recordInTransaction: vi.fn().mockResolvedValue({ id: 'movement-1' }) };
  const inventoryLocations = {
    findStockLocation: vi.fn().mockResolvedValue({ id: 'inv-loc-stock-1' }),
  };
  const service = new WriteOffService(
    repo as never,
    dataSource as never,
    sequences as never,
    inventoryMovements as never,
    inventoryLocations as never,
  );
  return {
    service,
    repo,
    txWriteOffRepo,
    txItemRepo,
    locationRepo,
    variantRepo,
    incidentRepo,
    inventoryLocations,
    idempotencyRepo,
    sequences,
    inventoryMovements,
    manager,
    dataSource,
  };
}

const COMPANY = 'company-1';
const USER = 'user-1';
const input = {
  locationId: 'store-1',
  reason: 'Vencido',
  items: [{ productVariantId: 'variant-1', quantity: '2' }],
};

describe('WriteOffService', () => {
  describe('findAll', () => {
    it('only lists the write-offs of the company', async () => {
      const { service, repo } = createService();

      await service.findAll(COMPANY);

      expect(repo.find).toHaveBeenCalledWith({ where: { companyId: COMPANY }, order: { requestedAt: 'DESC' } });
    });
  });

  describe('findOne', () => {
    it('looks it up inside the company', async () => {
      const { service, repo } = createService();
      repo.findOneBy.mockResolvedValue(null);

      await expect(service.findOne(COMPANY, 'missing')).rejects.toThrow(NotFoundException);
    });
  });

  describe('request', () => {
    it('creates the write-off with its items, numbered by company', async () => {
      const { service, txWriteOffRepo, txItemRepo, sequences } = createService();

      const writeOff = await service.request(COMPANY, USER, input);

      expect(sequences.next).toHaveBeenCalledWith(expect.anything(), COMPANY, 'WRITE_OFF');
      expect(txWriteOffRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({ companyId: COMPANY, writeOffNumber: 'BAJA-00001', requestedBy: USER }),
      );
      expect(txItemRepo.save).toHaveBeenCalledWith([
        expect.objectContaining({ writeOffId: 'write-off-1', productVariantId: 'variant-1' }),
      ]);
      expect(txItemRepo.save.mock.calls[0][0][0].quantity.toFixed(2)).toBe('2.00');
      expect(writeOff.id).toBe('write-off-1');
    });

    it('rejects a location of another company', async () => {
      const { service, locationRepo, txWriteOffRepo } = createService();
      locationRepo.existsBy.mockResolvedValue(false);

      await expect(service.request(COMPANY, USER, input)).rejects.toThrow(NotFoundException);
      expect(txWriteOffRepo.save).not.toHaveBeenCalled();
    });

    it('rejects a variant of another company', async () => {
      const { service, variantRepo, txWriteOffRepo } = createService();
      variantRepo.existsBy.mockResolvedValue(false);

      await expect(service.request(COMPANY, USER, input)).rejects.toThrow(NotFoundException);
      expect(txWriteOffRepo.save).not.toHaveBeenCalled();
    });

    it('rejects an incident of another company', async () => {
      const { service, incidentRepo, txWriteOffRepo } = createService();
      incidentRepo.existsBy.mockResolvedValue(false);

      await expect(
        service.request(COMPANY, USER, { ...input, items: [{ ...input.items[0], incidentId: 'incident-9' }] }),
      ).rejects.toThrow(NotFoundException);
      expect(txWriteOffRepo.save).not.toHaveBeenCalled();
    });

    describe('with an idempotency key', () => {
      it('claims the key before saving anything', async () => {
        const { service, manager, dataSource, txWriteOffRepo } = createService();

        await service.request(COMPANY, USER, input, 'key-1');

        expect(dataSource.transaction).toHaveBeenCalledTimes(1);
        expect(manager.query).toHaveBeenNthCalledWith(
          1,
          expect.stringContaining('INSERT INTO "idempotency_keys"'),
          [COMPANY, USER, 'requestWriteOff', 'key-1', fingerprintOf(input)],
        );
        expect(manager.query.mock.invocationCallOrder[0]).toBeLessThan(
          txWriteOffRepo.save.mock.invocationCallOrder[0],
        );
      });
    });
  });

  describe('approve', () => {
    const pending = (overrides: Record<string, unknown> = {}) => ({
      id: 'write-off-1',
      companyId: COMPANY,
      locationId: 'store-1',
      writeOffNumber: 'BAJA-00001',
      status: WriteOffStatus.PENDING,
      ...overrides,
    });

    it('posts an ADJUSTMENT movement per item, from the STOCK of the write-off store, and approves it', async () => {
      const { service, repo, txWriteOffRepo, txItemRepo, inventoryLocations, inventoryMovements } =
        createService();
      repo.findOneBy.mockResolvedValue(pending());
      txWriteOffRepo.findOne.mockResolvedValue(pending());
      txItemRepo.find.mockResolvedValue([
        { id: 'item-1', writeOffId: 'write-off-1', productVariantId: 'variant-1', quantity: new Decimal('2') },
      ]);

      const writeOff = await service.approve(COMPANY, USER, 'write-off-1');

      expect(inventoryLocations.findStockLocation).toHaveBeenCalledWith(expect.anything(), COMPANY, 'store-1');
      expect(inventoryMovements.recordInTransaction).toHaveBeenCalledWith(
        expect.anything(),
        COMPANY,
        USER,
        expect.objectContaining({
          productVariantId: 'variant-1',
          fromLocationId: 'inv-loc-stock-1',
          quantity: expect.any(Decimal),
          type: InventoryMovementType.ADJUSTMENT,
          sourceType: InventorySourceType.MANUAL_ADJUSTMENT,
          sourceId: 'write-off-1',
        }),
      );
      expect(writeOff.status).toBe(WriteOffStatus.APPROVED);
      expect(writeOff.resolvedBy).toBe(USER);
    });

    it('fails as a whole when the store has no active STOCK to discount from, and posts no movement', async () => {
      const { service, repo, txWriteOffRepo, inventoryLocations, inventoryMovements } = createService();
      repo.findOneBy.mockResolvedValue(pending());
      txWriteOffRepo.findOne.mockResolvedValue(pending());
      inventoryLocations.findStockLocation.mockRejectedValue(new NotFoundException('Esta sede no tiene una ubicación de inventario STOCK activa'));

      await expect(service.approve(COMPANY, USER, 'write-off-1')).rejects.toThrow(NotFoundException);
      expect(inventoryMovements.recordInTransaction).not.toHaveBeenCalled();
      expect(txWriteOffRepo.save).not.toHaveBeenCalled();
    });

    it('does not approve one already resolved', async () => {
      const { service, repo, txWriteOffRepo } = createService();
      repo.findOneBy.mockResolvedValue(pending({ status: WriteOffStatus.APPROVED }));
      txWriteOffRepo.findOne.mockResolvedValue(pending({ status: WriteOffStatus.APPROVED }));

      await expect(service.approve(COMPANY, USER, 'write-off-1')).rejects.toThrow(ConflictException);
      expect(txWriteOffRepo.save).not.toHaveBeenCalled();
    });

    it('cannot reach a write-off of another company', async () => {
      const { service, repo, dataSource } = createService();
      repo.findOneBy.mockResolvedValue(null);

      await expect(service.approve(COMPANY, USER, 'missing')).rejects.toThrow(NotFoundException);
      expect(dataSource.transaction).not.toHaveBeenCalled();
    });
  });

  describe('reject', () => {
    it('rejects a pending write-off without touching inventory', async () => {
      const { service, repo, txWriteOffRepo, inventoryMovements } = createService();
      repo.findOneBy.mockResolvedValue({ id: 'write-off-1', status: WriteOffStatus.PENDING });
      txWriteOffRepo.findOne.mockResolvedValue({ id: 'write-off-1', status: WriteOffStatus.PENDING });

      const writeOff = await service.reject(COMPANY, USER, 'write-off-1');

      expect(writeOff.status).toBe(WriteOffStatus.REJECTED);
      expect(inventoryMovements.recordInTransaction).not.toHaveBeenCalled();
    });
  });

  describe('cancel', () => {
    it('lets whoever requested it cancel it, without the approve permission', async () => {
      const { service, repo, txWriteOffRepo } = createService();
      repo.findOneBy.mockResolvedValue({ id: 'write-off-1', requestedBy: USER, status: WriteOffStatus.PENDING });
      txWriteOffRepo.findOne.mockResolvedValue({ id: 'write-off-1', requestedBy: USER, status: WriteOffStatus.PENDING });

      const writeOff = await service.cancel(COMPANY, { userId: USER, canResolve: false }, 'write-off-1');

      expect(writeOff.status).toBe(WriteOffStatus.CANCELLED);
    });

    it('lets someone with the approve permission cancel someone else’s', async () => {
      const { service, repo, txWriteOffRepo } = createService();
      repo.findOneBy.mockResolvedValue({ id: 'write-off-1', requestedBy: 'other-user', status: WriteOffStatus.PENDING });
      txWriteOffRepo.findOne.mockResolvedValue({ id: 'write-off-1', requestedBy: 'other-user', status: WriteOffStatus.PENDING });

      const writeOff = await service.cancel(COMPANY, { userId: USER, canResolve: true }, 'write-off-1');

      expect(writeOff.status).toBe(WriteOffStatus.CANCELLED);
    });

    it('rejects someone with neither the request nor the approve permission', async () => {
      const { service, repo, txWriteOffRepo } = createService();
      repo.findOneBy.mockResolvedValue({ id: 'write-off-1', requestedBy: 'other-user', status: WriteOffStatus.PENDING });
      txWriteOffRepo.findOne.mockResolvedValue({ id: 'write-off-1', requestedBy: 'other-user', status: WriteOffStatus.PENDING });

      await expect(
        service.cancel(COMPANY, { userId: USER, canResolve: false }, 'write-off-1'),
      ).rejects.toThrow(ForbiddenException);
      expect(txWriteOffRepo.save).not.toHaveBeenCalled();
    });

    it('does not cancel one already resolved', async () => {
      const { service, repo, txWriteOffRepo } = createService();
      repo.findOneBy.mockResolvedValue({ id: 'write-off-1', requestedBy: USER, status: WriteOffStatus.APPROVED });
      txWriteOffRepo.findOne.mockResolvedValue({ id: 'write-off-1', requestedBy: USER, status: WriteOffStatus.APPROVED });

      await expect(
        service.cancel(COMPANY, { userId: USER, canResolve: false }, 'write-off-1'),
      ).rejects.toThrow(ConflictException);
      expect(txWriteOffRepo.save).not.toHaveBeenCalled();
    });
  });
});
