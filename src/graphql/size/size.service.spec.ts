import { ConflictException, NotFoundException } from '@nestjs/common';
import { IdempotencyKey } from '../idempotency/entities/idempotency-key.entity.js';
import { fingerprintOf } from '../idempotency/idempotency.js';
import { SizeService } from './size.service.js';

const claimKey = (sql: string) =>
  sql.includes('INSERT INTO "idempotency_keys"') ? [{ id: 'claim-1' }] : [];

function createService() {
  const repo = { find: vi.fn().mockResolvedValue([]), findOneBy: vi.fn() };
  const txSizeRepo = {
    create: vi.fn((value: unknown) => value),
    save: vi.fn(async (value: object) => ({ id: 'size-1', ...value })),
    findOneByOrFail: vi.fn(),
    existsBy: vi.fn().mockResolvedValue(false),
  };
  const idempotencyRepo = { findOneBy: vi.fn().mockResolvedValue(null) };
  const manager = {
    getRepository: (entity: unknown) => (entity === IdempotencyKey ? idempotencyRepo : txSizeRepo),
    query: vi.fn(async (sql: string) => claimKey(sql)),
  };
  const dataSource = {
    transaction: vi.fn(async (fn: (manager: unknown) => unknown) => fn(manager)),
  };
  const service = new SizeService(repo as never, dataSource as never);
  return { service, repo, txSizeRepo, idempotencyRepo, manager, dataSource };
}

const COMPANY = 'company-1';
const USER = 'user-1';
const input = { name: '38' };

describe('SizeService', () => {
  describe('findAll', () => {
    it('lists every size, with no company filter: the catalog is shared', async () => {
      const { service, repo } = createService();

      await service.findAll();

      expect(repo.find).toHaveBeenCalledWith({ order: { name: 'ASC' } });
    });
  });

  describe('findOne', () => {
    it('answers "not found" for a size that does not exist', async () => {
      const { service, repo } = createService();
      repo.findOneBy.mockResolvedValue(null);

      await expect(service.findOne('missing')).rejects.toThrow(NotFoundException);
    });
  });

  describe('create', () => {
    it('creates the size', async () => {
      const { service, txSizeRepo } = createService();

      const size = await service.create(COMPANY, USER, input);

      expect(txSizeRepo.create).toHaveBeenCalledWith({ name: '38' });
      expect(size.id).toBe('size-1');
    });

    it('rejects a name that already exists', async () => {
      const { service, txSizeRepo } = createService();
      txSizeRepo.existsBy.mockResolvedValue(true);

      await expect(service.create(COMPANY, USER, input)).rejects.toThrow(ConflictException);
      expect(txSizeRepo.save).not.toHaveBeenCalled();
    });

    describe('with an idempotency key', () => {
      it('claims the key in the same transaction as the creation, before saving anything', async () => {
        const { service, manager, dataSource, txSizeRepo } = createService();

        await service.create(COMPANY, USER, input, 'key-1');

        expect(dataSource.transaction).toHaveBeenCalledTimes(1);
        expect(manager.query).toHaveBeenNthCalledWith(
          1,
          expect.stringContaining('INSERT INTO "idempotency_keys"'),
          [COMPANY, USER, 'createSize', 'key-1', fingerprintOf(input)],
        );
        expect(manager.query.mock.invocationCallOrder[0]).toBeLessThan(
          txSizeRepo.save.mock.invocationCallOrder[0],
        );
      });

      it('a repeated request gets back the same size, without creating another', async () => {
        const { service, manager, idempotencyRepo, txSizeRepo } = createService();
        manager.query = vi.fn(async () => []);
        idempotencyRepo.findOneBy.mockResolvedValue({
          fingerprint: fingerprintOf(input),
          resourceId: 'size-1',
        });
        txSizeRepo.findOneByOrFail.mockResolvedValue({ id: 'size-1', ...input });

        const size = await service.create(COMPANY, USER, input, 'key-1');

        expect(size.id).toBe('size-1');
        expect(txSizeRepo.save).not.toHaveBeenCalled();
      });
    });
  });
});
