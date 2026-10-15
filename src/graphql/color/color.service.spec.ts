import { ConflictException, NotFoundException } from '@nestjs/common';
import { IdempotencyKey } from '../idempotency/entities/idempotency-key.entity.js';
import { fingerprintOf } from '../idempotency/idempotency.js';
import { ColorService } from './color.service.js';

const claimKey = (sql: string) =>
  sql.includes('INSERT INTO "idempotency_keys"') ? [{ id: 'claim-1' }] : [];

function createService() {
  const repo = { find: vi.fn().mockResolvedValue([]), findOneBy: vi.fn() };
  const txColorRepo = {
    create: vi.fn((value: unknown) => value),
    save: vi.fn(async (value: object) => ({ id: 'color-1', ...value })),
    findOneByOrFail: vi.fn(),
    existsBy: vi.fn().mockResolvedValue(false),
  };
  const idempotencyRepo = { findOneBy: vi.fn().mockResolvedValue(null) };
  const manager = {
    getRepository: (entity: unknown) => (entity === IdempotencyKey ? idempotencyRepo : txColorRepo),
    query: vi.fn(async (sql: string) => claimKey(sql)),
  };
  const dataSource = {
    transaction: vi.fn(async (fn: (manager: unknown) => unknown) => fn(manager)),
  };
  const service = new ColorService(repo as never, dataSource as never);
  return { service, repo, txColorRepo, idempotencyRepo, manager, dataSource };
}

const COMPANY = 'company-1';
const USER = 'user-1';
const input = { name: 'Rojo', hex: '#FF0000' };

describe('ColorService', () => {
  describe('findAll', () => {
    it('lists every color, with no company filter: the catalog is shared', async () => {
      const { service, repo } = createService();

      await service.findAll();

      expect(repo.find).toHaveBeenCalledWith({ order: { name: 'ASC' } });
    });
  });

  describe('findOne', () => {
    it('answers "not found" for a color that does not exist', async () => {
      const { service, repo } = createService();
      repo.findOneBy.mockResolvedValue(null);

      await expect(service.findOne('missing')).rejects.toThrow(NotFoundException);
    });
  });

  describe('create', () => {
    it('creates the color', async () => {
      const { service, txColorRepo } = createService();

      const color = await service.create(COMPANY, USER, input);

      expect(txColorRepo.create).toHaveBeenCalledWith({ name: 'Rojo', hex: '#FF0000', secondHex: null });
      expect(color.id).toBe('color-1');
    });

    it('keeps no hex when none comes with it', async () => {
      const { service, txColorRepo } = createService();

      await service.create(COMPANY, USER, { name: 'Rojo' });

      expect(txColorRepo.create.mock.calls[0][0]).toMatchObject({ hex: null, secondHex: null });
    });

    it('saves the second tone of a combined color, when it comes with one', async () => {
      const { service, txColorRepo } = createService();

      await service.create(COMPANY, USER, { name: 'Blanco negro', hex: '#FFFFFF', secondHex: '#000000' });

      expect(txColorRepo.create.mock.calls[0][0]).toMatchObject({ hex: '#FFFFFF', secondHex: '#000000' });
    });

    it('rejects a name that already exists, case-insensitive', async () => {
      const { service, txColorRepo } = createService();
      txColorRepo.existsBy.mockResolvedValue(true);

      await expect(service.create(COMPANY, USER, { name: 'rojo' })).rejects.toThrow(ConflictException);
      expect(txColorRepo.save).not.toHaveBeenCalled();
    });

    describe('with an idempotency key', () => {
      it('claims the key in the same transaction as the creation, before saving anything', async () => {
        const { service, manager, dataSource, txColorRepo } = createService();

        await service.create(COMPANY, USER, input, 'key-1');

        expect(dataSource.transaction).toHaveBeenCalledTimes(1);
        expect(manager.query).toHaveBeenNthCalledWith(
          1,
          expect.stringContaining('INSERT INTO "idempotency_keys"'),
          [COMPANY, USER, 'createColor', 'key-1', fingerprintOf(input)],
        );
        expect(manager.query.mock.invocationCallOrder[0]).toBeLessThan(
          txColorRepo.save.mock.invocationCallOrder[0],
        );
      });

      it('a repeated request gets back the same color, without creating another', async () => {
        const { service, manager, idempotencyRepo, txColorRepo } = createService();
        manager.query = vi.fn(async () => []);
        idempotencyRepo.findOneBy.mockResolvedValue({
          fingerprint: fingerprintOf(input),
          resourceId: 'color-1',
        });
        txColorRepo.findOneByOrFail.mockResolvedValue({ id: 'color-1', ...input });

        const color = await service.create(COMPANY, USER, input, 'key-1');

        expect(color.id).toBe('color-1');
        expect(txColorRepo.save).not.toHaveBeenCalled();
      });
    });
  });
});
