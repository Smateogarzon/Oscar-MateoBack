import { BadRequestException, NotFoundException } from '@nestjs/common';
import { RecordStatus } from '../../common/enums/record-status.enum.js';
import { IdempotencyKey } from '../idempotency/entities/idempotency-key.entity.js';
import { fingerprintOf } from '../idempotency/idempotency.js';
import { Location } from '../location/entities/location.entity.js';
import { User } from '../user/entities/user.entity.js';
import { UserCompanyRole } from '../user-company-role/entities/user-company-role.entity.js';
import { InventoryLocationType } from './entities/inventory-location-type.enum.js';
import { InventoryLocationService } from './inventory-location.service.js';

const claimKey = (sql: string) =>
  sql.includes('INSERT INTO "idempotency_keys"') ? [{ id: 'claim-1' }] : [];

function createService() {
  const repo = { find: vi.fn().mockResolvedValue([]), findOneBy: vi.fn() };
  const txInventoryLocationRepo = {
    create: vi.fn((value: unknown) => value),
    save: vi.fn(async (value: object) => ({ id: 'inv-loc-1', ...value })),
    findOne: vi.fn(),
    findOneByOrFail: vi.fn(),
  };
  const locationRepo = { existsBy: vi.fn().mockResolvedValue(true) };
  const membershipRepo = { existsBy: vi.fn().mockResolvedValue(true) };
  const userRepo = { existsBy: vi.fn().mockResolvedValue(true) };
  const idempotencyRepo = { findOneBy: vi.fn().mockResolvedValue(null) };
  const manager = {
    getRepository: (entity: unknown) =>
      entity === Location
        ? locationRepo
        : entity === UserCompanyRole
          ? membershipRepo
          : entity === User
            ? userRepo
            : entity === IdempotencyKey
              ? idempotencyRepo
              : txInventoryLocationRepo,
    query: vi.fn(async (sql: string) => claimKey(sql)),
  };
  const dataSource = {
    transaction: vi.fn(async (fn: (manager: unknown) => unknown) => fn(manager)),
  };
  const service = new InventoryLocationService(repo as never, dataSource as never);
  return {
    service,
    repo,
    txInventoryLocationRepo,
    locationRepo,
    membershipRepo,
    userRepo,
    idempotencyRepo,
    manager,
    dataSource,
  };
}

const COMPANY = 'company-1';
const USER = 'user-1';

describe('InventoryLocationService', () => {
  describe('findAll', () => {
    it('only lists the inventory locations of the company', async () => {
      const { service, repo } = createService();

      await service.findAll(COMPANY);

      expect(repo.find).toHaveBeenCalledWith({
        where: { companyId: COMPANY },
        order: { createdAt: 'ASC' },
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

  describe('create', () => {
    it.each([
      InventoryLocationType.STOCK,
      InventoryLocationType.DISPLAY,
      InventoryLocationType.DAMAGED,
      InventoryLocationType.RETURNS,
    ])('creates a %s tied to a store of the company', async (type) => {
      const { service, txInventoryLocationRepo, locationRepo } = createService();

      const created = await service.create(COMPANY, USER, { type, locationId: 'store-1' });

      expect(locationRepo.existsBy).toHaveBeenCalledWith({ id: 'store-1', companyId: COMPANY });
      expect(txInventoryLocationRepo.create).toHaveBeenCalledWith({
        companyId: COMPANY,
        type,
        locationId: 'store-1',
        custodianUserId: null,
      });
      expect(created.id).toBe('inv-loc-1');
    });

    it.each([InventoryLocationType.STOCK, InventoryLocationType.DAMAGED])(
      'rejects a %s with no store',
      async (type) => {
        const { service, txInventoryLocationRepo } = createService();

        await expect(service.create(COMPANY, USER, { type })).rejects.toThrow(BadRequestException);
        expect(txInventoryLocationRepo.save).not.toHaveBeenCalled();
      },
    );

    it('rejects a store of another company (or one that does not exist)', async () => {
      const { service, locationRepo, txInventoryLocationRepo } = createService();
      locationRepo.existsBy.mockResolvedValue(false);

      await expect(
        service.create(COMPANY, USER, { type: InventoryLocationType.STOCK, locationId: 'store-9' }),
      ).rejects.toThrow(NotFoundException);
      expect(txInventoryLocationRepo.save).not.toHaveBeenCalled();
    });

    it('creates a RUNNER tied to its custodian, with no store', async () => {
      const { service, txInventoryLocationRepo, membershipRepo, userRepo } = createService();

      await service.create(COMPANY, USER, {
        type: InventoryLocationType.RUNNER,
        custodianUserId: 'runner-1',
      });

      expect(membershipRepo.existsBy).toHaveBeenCalledWith({
        userId: 'runner-1',
        companyId: COMPANY,
        status: RecordStatus.ACTIVE,
      });
      expect(userRepo.existsBy).toHaveBeenCalledWith({ id: 'runner-1', status: RecordStatus.ACTIVE });
      expect(txInventoryLocationRepo.create.mock.calls[0][0]).toMatchObject({ custodianUserId: 'runner-1' });
    });

    it('rejects a RUNNER with no custodian', async () => {
      const { service, txInventoryLocationRepo } = createService();

      await expect(
        service.create(COMPANY, USER, { type: InventoryLocationType.RUNNER }),
      ).rejects.toThrow(BadRequestException);
      expect(txInventoryLocationRepo.save).not.toHaveBeenCalled();
    });

    it('rejects a RUNNER that also comes with a store', async () => {
      const { service, txInventoryLocationRepo } = createService();

      await expect(
        service.create(COMPANY, USER, {
          type: InventoryLocationType.RUNNER,
          custodianUserId: 'runner-1',
          locationId: 'store-1',
        }),
      ).rejects.toThrow(BadRequestException);
      expect(txInventoryLocationRepo.save).not.toHaveBeenCalled();
    });

    it('rejects a custodian who is not an active member of the company', async () => {
      const { service, membershipRepo, txInventoryLocationRepo } = createService();
      membershipRepo.existsBy.mockResolvedValue(false);

      await expect(
        service.create(COMPANY, USER, {
          type: InventoryLocationType.RUNNER,
          custodianUserId: 'runner-9',
        }),
      ).rejects.toThrow(NotFoundException);
      expect(txInventoryLocationRepo.save).not.toHaveBeenCalled();
    });

    it('creates a TRANSIT with neither store nor custodian', async () => {
      const { service, txInventoryLocationRepo } = createService();

      await service.create(COMPANY, USER, { type: InventoryLocationType.TRANSIT });

      expect(txInventoryLocationRepo.create).toHaveBeenCalledWith({
        companyId: COMPANY,
        type: InventoryLocationType.TRANSIT,
        locationId: null,
        custodianUserId: null,
      });
    });

    it('rejects a store on a type that does not carry one, like TRANSIT with a custodian', async () => {
      const { service, txInventoryLocationRepo } = createService();

      await expect(
        service.create(COMPANY, USER, { type: InventoryLocationType.TRANSIT, custodianUserId: 'user-9' }),
      ).rejects.toThrow(BadRequestException);
      expect(txInventoryLocationRepo.save).not.toHaveBeenCalled();
    });

    describe('with an idempotency key', () => {
      it('claims the key in the same transaction as the creation, before saving anything', async () => {
        const { service, manager, dataSource, txInventoryLocationRepo } = createService();
        const input = { type: InventoryLocationType.STOCK, locationId: 'store-1' };

        await service.create(COMPANY, USER, input, 'key-1');

        expect(dataSource.transaction).toHaveBeenCalledTimes(1);
        expect(manager.query).toHaveBeenNthCalledWith(
          1,
          expect.stringContaining('INSERT INTO "idempotency_keys"'),
          [COMPANY, USER, 'createInventoryLocation', 'key-1', fingerprintOf(input)],
        );
        expect(manager.query.mock.invocationCallOrder[0]).toBeLessThan(
          txInventoryLocationRepo.save.mock.invocationCallOrder[0],
        );
      });
    });
  });

  describe('deactivate', () => {
    it('deactivates inside a transaction', async () => {
      const { service, repo, txInventoryLocationRepo, dataSource } = createService();
      repo.findOneBy.mockResolvedValue({ id: 'inv-loc-1', status: RecordStatus.ACTIVE });
      txInventoryLocationRepo.findOne.mockResolvedValue({ id: 'inv-loc-1', status: RecordStatus.ACTIVE });

      const result = await service.deactivate(COMPANY, 'inv-loc-1');

      expect(dataSource.transaction).toHaveBeenCalled();
      expect(result.status).toBe(RecordStatus.INACTIVE);
    });

    it('cannot reach one of another company', async () => {
      const { service, repo, dataSource } = createService();
      repo.findOneBy.mockResolvedValue(null);

      await expect(service.deactivate(COMPANY, 'missing')).rejects.toThrow(NotFoundException);
      expect(dataSource.transaction).not.toHaveBeenCalled();
    });
  });

  describe('activate', () => {
    it('puts it back in service inside a transaction', async () => {
      const { service, repo, txInventoryLocationRepo, dataSource } = createService();
      repo.findOneBy.mockResolvedValue({ id: 'inv-loc-1', status: RecordStatus.INACTIVE });
      txInventoryLocationRepo.findOne.mockResolvedValue({ id: 'inv-loc-1', status: RecordStatus.INACTIVE });

      const result = await service.activate(COMPANY, 'inv-loc-1');

      expect(dataSource.transaction).toHaveBeenCalled();
      expect(result.status).toBe(RecordStatus.ACTIVE);
    });
  });

  describe('findStockLocation', () => {
    it('finds the active STOCK of a given store', async () => {
      const { service, manager, txInventoryLocationRepo } = createService();
      txInventoryLocationRepo.findOne.mockResolvedValue({ id: 'inv-loc-1', type: InventoryLocationType.STOCK });

      const found = await service.findStockLocation(manager as never, COMPANY, 'store-1');

      expect(txInventoryLocationRepo.findOne).toHaveBeenCalledWith({
        where: {
          companyId: COMPANY,
          locationId: 'store-1',
          type: InventoryLocationType.STOCK,
          status: RecordStatus.ACTIVE,
        },
        order: { createdAt: 'ASC' },
      });
      expect(found.id).toBe('inv-loc-1');
    });

    it('fails when that store has no active STOCK', async () => {
      const { service, manager, txInventoryLocationRepo } = createService();
      txInventoryLocationRepo.findOne.mockResolvedValue(null);

      await expect(service.findStockLocation(manager as never, COMPANY, 'store-1')).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  describe('findOrCreateRunnerLocation', () => {
    it('reuses the runner’s existing bag instead of creating another', async () => {
      const { service, manager, txInventoryLocationRepo } = createService();
      txInventoryLocationRepo.findOne.mockResolvedValue({ id: 'inv-loc-runner-1' });

      const location = await service.findOrCreateRunnerLocation(manager as never, COMPANY, 'runner-1');

      expect(txInventoryLocationRepo.findOne).toHaveBeenCalledWith({
        where: {
          companyId: COMPANY,
          custodianUserId: 'runner-1',
          type: InventoryLocationType.RUNNER,
          status: RecordStatus.ACTIVE,
        },
        order: { createdAt: 'ASC' },
      });
      expect(location.id).toBe('inv-loc-runner-1');
      expect(txInventoryLocationRepo.save).not.toHaveBeenCalled();
    });

    it('creates the bag the first time that runner needs one', async () => {
      const { service, manager, txInventoryLocationRepo } = createService();
      txInventoryLocationRepo.findOne.mockResolvedValue(null);

      const location = await service.findOrCreateRunnerLocation(manager as never, COMPANY, 'runner-1');

      expect(txInventoryLocationRepo.create).toHaveBeenCalledWith({
        companyId: COMPANY,
        type: InventoryLocationType.RUNNER,
        locationId: null,
        custodianUserId: 'runner-1',
      });
      expect(location.id).toBe('inv-loc-1');
    });
  });
});
