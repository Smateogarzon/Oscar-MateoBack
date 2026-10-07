import { ConflictException, NotFoundException } from '@nestjs/common';
import { RecordStatus } from '../../common/enums/record-status.enum.js';
import { IdempotencyKey } from '../idempotency/entities/idempotency-key.entity.js';
import { fingerprintOf } from '../idempotency/idempotency.js';
import { BrandService } from './brand.service.js';

// Reclamar la clave de idempotencia (INSERT ... RETURNING) devuelve la fila reclamada: la clave era
// nueva. El UPDATE que la enlaza con lo que se creó no devuelve nada.
const claimKey = (sql: string) =>
  sql.includes('INSERT INTO "idempotency_keys"') ? [{ id: 'claim-1' }] : [];

function createService() {
  const repo = { find: vi.fn().mockResolvedValue([]), findOneBy: vi.fn() };
  const txBrandRepo = {
    create: vi.fn((value: unknown) => value),
    save: vi.fn(async (value: object) => ({ id: 'brand-1', ...value })),
    findOne: vi.fn(),
    findOneByOrFail: vi.fn(),
    existsBy: vi.fn().mockResolvedValue(false),
  };
  // Las claves de idempotencia ya reclamadas: por defecto, ninguna (la petición es nueva).
  const idempotencyRepo = { findOneBy: vi.fn().mockResolvedValue(null) };
  const manager = {
    getRepository: (entity: unknown) => (entity === IdempotencyKey ? idempotencyRepo : txBrandRepo),
    query: vi.fn(async (sql: string) => claimKey(sql)),
  };
  const dataSource = {
    transaction: vi.fn(async (fn: (manager: unknown) => unknown) => fn(manager)),
  };
  const service = new BrandService(repo as never, dataSource as never);
  return { service, repo, txBrandRepo, idempotencyRepo, manager, dataSource };
}

const COMPANY = 'company-1';
const USER = 'user-1';
const input = { name: 'Nike' };

describe('BrandService', () => {
  describe('findAll', () => {
    it('lists every brand, with no company filter: the catalog is shared', async () => {
      const { service, repo } = createService();

      await service.findAll();

      expect(repo.find).toHaveBeenCalledWith({ where: {}, order: { name: 'ASC' } });
    });

    it('can narrow the list down by status', async () => {
      const { service, repo } = createService();

      await service.findAll(RecordStatus.ACTIVE);

      expect(repo.find).toHaveBeenCalledWith({
        where: { status: RecordStatus.ACTIVE },
        order: { name: 'ASC' },
      });
    });
  });

  describe('findOne', () => {
    it('answers "not found" for a brand that does not exist', async () => {
      const { service, repo } = createService();
      repo.findOneBy.mockResolvedValue(null);

      await expect(service.findOne('missing')).rejects.toThrow(NotFoundException);
    });
  });

  describe('create', () => {
    it('creates the brand with a slug built from its name', async () => {
      const { service, txBrandRepo } = createService();

      const brand = await service.create(COMPANY, USER, input);

      expect(txBrandRepo.create).toHaveBeenCalledWith({ name: 'Nike', slug: 'nike', logoUrl: null });
      expect(brand.id).toBe('brand-1');
    });

    it('rejects a name that already exists, case-insensitive, before saving anything', async () => {
      const { service, txBrandRepo } = createService();
      txBrandRepo.existsBy.mockResolvedValue(true);

      await expect(service.create(COMPANY, USER, { name: 'nike' })).rejects.toThrow(ConflictException);
      expect(txBrandRepo.save).not.toHaveBeenCalled();
    });

    it('appends a numeric suffix when the slug is already taken', async () => {
      const { service, txBrandRepo } = createService();
      txBrandRepo.existsBy.mockResolvedValueOnce(false).mockResolvedValueOnce(true).mockResolvedValueOnce(false);

      await service.create(COMPANY, USER, input);

      expect(txBrandRepo.create.mock.calls[0][0].slug).toBe('nike-2');
    });

    it('keeps the logo when it comes with one', async () => {
      const { service, txBrandRepo } = createService();

      await service.create(COMPANY, USER, { ...input, logoUrl: 'https://cdn.example.com/nike.png' });

      expect(txBrandRepo.create.mock.calls[0][0]).toMatchObject({
        logoUrl: 'https://cdn.example.com/nike.png',
      });
    });

    describe('with an idempotency key', () => {
      it('claims the key in the same transaction as the creation, before saving anything', async () => {
        const { service, manager, dataSource, txBrandRepo } = createService();

        await service.create(COMPANY, USER, input, 'key-1');

        expect(dataSource.transaction).toHaveBeenCalledTimes(1);
        expect(manager.query).toHaveBeenNthCalledWith(
          1,
          expect.stringContaining('INSERT INTO "idempotency_keys"'),
          [COMPANY, USER, 'createBrand', 'key-1', fingerprintOf(input)],
        );
        expect(manager.query.mock.invocationCallOrder[0]).toBeLessThan(
          txBrandRepo.save.mock.invocationCallOrder[0],
        );
      });

      it('a repeated request (double click on "Crear marca") gets back the same brand, without creating another', async () => {
        const { service, manager, idempotencyRepo, txBrandRepo } = createService();
        // La clave ya estaba reclamada por la primera petición, que creó la marca 'brand-1'.
        manager.query = vi.fn(async () => []);
        idempotencyRepo.findOneBy.mockResolvedValue({
          fingerprint: fingerprintOf(input),
          resourceId: 'brand-1',
        });
        txBrandRepo.findOneByOrFail.mockResolvedValue({ id: 'brand-1', ...input });

        const brand = await service.create(COMPANY, USER, input, 'key-1');

        expect(idempotencyRepo.findOneBy).toHaveBeenCalledWith({
          companyId: COMPANY,
          userId: USER,
          operation: 'createBrand',
          key: 'key-1',
        });
        expect(txBrandRepo.findOneByOrFail).toHaveBeenCalledWith({ id: 'brand-1' });
        expect(brand.id).toBe('brand-1');
        expect(txBrandRepo.save).not.toHaveBeenCalled();
      });

      it('the same key with other data is not a retry: it is refused and nothing is created', async () => {
        const { service, manager, idempotencyRepo, txBrandRepo } = createService();
        manager.query = vi.fn(async () => []);
        idempotencyRepo.findOneBy.mockResolvedValue({
          fingerprint: fingerprintOf({ name: 'Otra marca' }),
          resourceId: 'brand-1',
        });

        await expect(service.create(COMPANY, USER, input, 'key-1')).rejects.toThrow(ConflictException);
        expect(txBrandRepo.save).not.toHaveBeenCalled();
      });
    });
  });

  describe('update', () => {
    it('cannot reach a brand that does not exist', async () => {
      const { service, repo, dataSource } = createService();
      repo.findOneBy.mockResolvedValue(null);

      await expect(service.update('missing', { name: 'X' })).rejects.toThrow(NotFoundException);
      expect(dataSource.transaction).not.toHaveBeenCalled();
    });

    it('renames the brand and regenerates its slug', async () => {
      const { service, repo, txBrandRepo } = createService();
      repo.findOneBy.mockResolvedValue({ id: 'brand-1', name: 'Nike', slug: 'nike', logoUrl: null });
      txBrandRepo.findOne.mockResolvedValue({ id: 'brand-1', name: 'Nike', slug: 'nike', logoUrl: null });

      const brand = await service.update('brand-1', { name: 'Adidas' });

      expect(brand.name).toBe('Adidas');
      expect(brand.slug).toBe('adidas');
    });

    it('rejects a rename to a name another brand already has', async () => {
      const { service, repo, txBrandRepo } = createService();
      repo.findOneBy.mockResolvedValue({ id: 'brand-1', name: 'Nike', slug: 'nike', logoUrl: null });
      txBrandRepo.findOne.mockResolvedValue({ id: 'brand-1', name: 'Nike', slug: 'nike', logoUrl: null });
      txBrandRepo.existsBy.mockResolvedValue(true);

      await expect(service.update('brand-1', { name: 'Adidas' })).rejects.toThrow(ConflictException);
      // No se cuenta a sí misma como choque: el existsBy que sí importa aquí es el que excluye su id.
      expect(txBrandRepo.existsBy).toHaveBeenCalledWith(
        expect.objectContaining({ id: expect.anything() }),
      );
      expect(txBrandRepo.save).not.toHaveBeenCalled();
    });

    it('does not touch the slug when the name does not change', async () => {
      const { service, repo, txBrandRepo } = createService();
      repo.findOneBy.mockResolvedValue({ id: 'brand-1', name: 'Nike', slug: 'nike', logoUrl: null });
      txBrandRepo.findOne.mockResolvedValue({ id: 'brand-1', name: 'Nike', slug: 'nike', logoUrl: null });

      const brand = await service.update('brand-1', { logoUrl: 'https://cdn.example.com/nike.png' });

      expect(brand.slug).toBe('nike');
      expect(brand.logoUrl).toBe('https://cdn.example.com/nike.png');
    });

    it('clears the logo with null', async () => {
      const { service, repo, txBrandRepo } = createService();
      repo.findOneBy.mockResolvedValue({
        id: 'brand-1',
        name: 'Nike',
        slug: 'nike',
        logoUrl: 'https://cdn.example.com/nike.png',
      });
      txBrandRepo.findOne.mockResolvedValue({
        id: 'brand-1',
        name: 'Nike',
        slug: 'nike',
        logoUrl: 'https://cdn.example.com/nike.png',
      });

      const brand = await service.update('brand-1', { logoUrl: null });

      expect(brand.logoUrl).toBeNull();
    });

    it('locks the brand it changes, so it does not undo what somebody else changed meanwhile', async () => {
      const { service, repo, txBrandRepo } = createService();
      repo.findOneBy.mockResolvedValue({ id: 'brand-1', name: 'Nike', slug: 'nike', logoUrl: null });
      txBrandRepo.findOne.mockResolvedValue({
        id: 'brand-1',
        name: 'Nike',
        slug: 'nike',
        logoUrl: null,
        status: RecordStatus.INACTIVE,
      });

      const brand = await service.update('brand-1', { name: 'Adidas' });

      expect(txBrandRepo.findOne).toHaveBeenCalledWith({
        where: { id: 'brand-1' },
        lock: { mode: 'pessimistic_write' },
      });
      expect(brand.status).toBe(RecordStatus.INACTIVE);
    });
  });

  describe('deactivate', () => {
    it('deactivates a brand inside a transaction', async () => {
      const { service, repo, txBrandRepo, dataSource } = createService();
      repo.findOneBy.mockResolvedValue({ id: 'brand-1', status: RecordStatus.ACTIVE });
      txBrandRepo.findOne.mockResolvedValue({ id: 'brand-1', status: RecordStatus.ACTIVE });

      const brand = await service.deactivate('brand-1');

      expect(dataSource.transaction).toHaveBeenCalled();
      expect(brand.status).toBe(RecordStatus.INACTIVE);
    });

    it('cannot reach a brand that does not exist', async () => {
      const { service, repo } = createService();
      repo.findOneBy.mockResolvedValue(null);

      await expect(service.deactivate('missing')).rejects.toThrow(NotFoundException);
    });
  });

  describe('activate', () => {
    it('puts a brand back in service inside a transaction', async () => {
      const { service, repo, txBrandRepo, dataSource } = createService();
      repo.findOneBy.mockResolvedValue({ id: 'brand-1', status: RecordStatus.INACTIVE });
      txBrandRepo.findOne.mockResolvedValue({ id: 'brand-1', status: RecordStatus.INACTIVE });

      const brand = await service.activate('brand-1');

      expect(dataSource.transaction).toHaveBeenCalled();
      expect(brand.status).toBe(RecordStatus.ACTIVE);
    });
  });
});
