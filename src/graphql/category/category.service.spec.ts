import { IsNull } from 'typeorm';
import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import { RecordStatus } from '../../common/enums/record-status.enum.js';
import { IdempotencyKey } from '../idempotency/entities/idempotency-key.entity.js';
import { fingerprintOf } from '../idempotency/idempotency.js';
import { CategoryService } from './category.service.js';

// Reclamar la clave de idempotencia (INSERT ... RETURNING) devuelve la fila reclamada: la clave era
// nueva. El UPDATE que la enlaza con lo que se creó no devuelve nada. La consulta recursiva de
// "isDescendant" no la usa create() (una categoría nueva no tiene descendientes todavía).
const claimKey = (sql: string) =>
  sql.includes('INSERT INTO "idempotency_keys"') ? [{ id: 'claim-1' }] : [];

function createService() {
  const repo = { find: vi.fn().mockResolvedValue([]), findOneBy: vi.fn() };
  const txCategoryRepo = {
    create: vi.fn((value: unknown) => value),
    save: vi.fn(async (value: object) => ({ id: 'category-1', ...value })),
    findOne: vi.fn(),
    findOneByOrFail: vi.fn(),
    existsBy: vi.fn().mockResolvedValue(false),
  };
  // Las claves de idempotencia ya reclamadas: por defecto, ninguna (la petición es nueva).
  const idempotencyRepo = { findOneBy: vi.fn().mockResolvedValue(null) };
  const manager = {
    getRepository: (entity: unknown) => (entity === IdempotencyKey ? idempotencyRepo : txCategoryRepo),
    // Por defecto ninguna consulta recursiva encuentra descendientes; cada prueba de ciclos lo ajusta.
    query: vi.fn(async (sql: string) => claimKey(sql)),
  };
  const dataSource = {
    transaction: vi.fn(async (fn: (manager: unknown) => unknown) => fn(manager)),
  };
  const service = new CategoryService(repo as never, dataSource as never);
  return { service, repo, txCategoryRepo, idempotencyRepo, manager, dataSource };
}

const COMPANY = 'company-1';
const USER = 'user-1';
const input = { name: 'Zapatos deportivos' };

describe('CategoryService', () => {
  describe('findAll', () => {
    it('only lists the categories of the company', async () => {
      const { service, repo } = createService();

      await service.findAll(COMPANY);

      expect(repo.find).toHaveBeenCalledWith({ where: { companyId: COMPANY }, order: { name: 'ASC' } });
    });

    it('can narrow the list down by status', async () => {
      const { service, repo } = createService();

      await service.findAll(COMPANY, RecordStatus.ACTIVE);

      expect(repo.find).toHaveBeenCalledWith({
        where: { companyId: COMPANY, status: RecordStatus.ACTIVE },
        order: { name: 'ASC' },
      });
    });

    it('parentId: null lists only the root categories, not sending it lists all of them', async () => {
      const { service, repo } = createService();

      await service.findAll(COMPANY, undefined, null);
      expect(repo.find).toHaveBeenCalledWith({
        // Una raíz se busca con IsNull(): el `null` literal no es un valor de columna para TypeORM.
        where: { companyId: COMPANY, parentId: IsNull() },
        order: { name: 'ASC' },
      });

      await service.findAll(COMPANY);
      expect(repo.find).toHaveBeenLastCalledWith({
        where: { companyId: COMPANY },
        order: { name: 'ASC' },
      });
    });
  });

  describe('findOne', () => {
    it('looks the category up inside the company', async () => {
      const { service, repo } = createService();
      repo.findOneBy.mockResolvedValue(null);

      await expect(service.findOne(COMPANY, 'missing')).rejects.toThrow(NotFoundException);
      expect(repo.findOneBy).toHaveBeenCalledWith({ id: 'missing', companyId: COMPANY });
    });
  });

  describe('create', () => {
    it('creates a root category with a slug built from its name', async () => {
      const { service, txCategoryRepo } = createService();

      const category = await service.create(COMPANY, USER, input);

      expect(txCategoryRepo.create).toHaveBeenCalledWith({
        companyId: COMPANY,
        name: 'Zapatos deportivos',
        slug: 'zapatos-deportivos',
        parentId: null,
        description: null,
      });
      expect(category.id).toBe('category-1');
    });

    it('appends a numeric suffix when the slug is already taken in that company', async () => {
      const { service, txCategoryRepo } = createService();
      txCategoryRepo.existsBy.mockResolvedValueOnce(true).mockResolvedValueOnce(false);

      await service.create(COMPANY, USER, input);

      expect(txCategoryRepo.create.mock.calls[0][0].slug).toBe('zapatos-deportivos-2');
    });

    it('nests it under a parent of the same company', async () => {
      const { service, txCategoryRepo } = createService();
      // 1ª llamada: el padre existe en la empresa. 2ª en adelante (uniqueSlug): el slug está libre.
      txCategoryRepo.existsBy.mockResolvedValueOnce(true);

      await service.create(COMPANY, USER, { ...input, parentId: 'parent-1' });

      expect(txCategoryRepo.create.mock.calls[0][0]).toMatchObject({ parentId: 'parent-1' });
    });

    it('cannot nest under a parent of another company (or one that does not exist)', async () => {
      const { service, txCategoryRepo } = createService();
      // La primera llamada a existsBy es la del padre; no existe en esta empresa.
      txCategoryRepo.existsBy.mockResolvedValueOnce(false);

      await expect(
        service.create(COMPANY, USER, { ...input, parentId: 'parent-9' }),
      ).rejects.toThrow(NotFoundException);
      expect(txCategoryRepo.save).not.toHaveBeenCalled();
    });

    it('keeps the description when it comes with one', async () => {
      const { service, txCategoryRepo } = createService();

      await service.create(COMPANY, USER, { ...input, description: 'Tenis y zapatillas' });

      expect(txCategoryRepo.create.mock.calls[0][0]).toMatchObject({ description: 'Tenis y zapatillas' });
    });

    describe('with an idempotency key', () => {
      it('claims the key in the same transaction as the creation, before saving anything', async () => {
        const { service, manager, dataSource, txCategoryRepo } = createService();

        await service.create(COMPANY, USER, input, 'key-1');

        expect(dataSource.transaction).toHaveBeenCalledTimes(1);
        expect(manager.query).toHaveBeenNthCalledWith(
          1,
          expect.stringContaining('INSERT INTO "idempotency_keys"'),
          [COMPANY, USER, 'createCategory', 'key-1', fingerprintOf(input)],
        );
        expect(manager.query.mock.invocationCallOrder[0]).toBeLessThan(
          txCategoryRepo.save.mock.invocationCallOrder[0],
        );
      });

      it('a repeated request (double click on "Crear categoría") gets back the same category, without creating another', async () => {
        const { service, manager, idempotencyRepo, txCategoryRepo } = createService();
        manager.query = vi.fn(async () => []);
        idempotencyRepo.findOneBy.mockResolvedValue({
          fingerprint: fingerprintOf(input),
          resourceId: 'category-1',
        });
        txCategoryRepo.findOneByOrFail.mockResolvedValue({ id: 'category-1', ...input });

        const category = await service.create(COMPANY, USER, input, 'key-1');

        expect(txCategoryRepo.findOneByOrFail).toHaveBeenCalledWith({ id: 'category-1' });
        expect(category.id).toBe('category-1');
        expect(txCategoryRepo.save).not.toHaveBeenCalled();
      });
    });
  });

  describe('update', () => {
    const stored = (overrides: Record<string, unknown> = {}) => ({
      id: 'category-1',
      companyId: COMPANY,
      name: 'Zapatos deportivos',
      slug: 'zapatos-deportivos',
      parentId: null,
      description: null,
      status: RecordStatus.ACTIVE,
      ...overrides,
    });

    it('cannot reach a category of another company', async () => {
      const { service, repo, dataSource } = createService();
      repo.findOneBy.mockResolvedValue(null);

      await expect(service.update(COMPANY, 'missing', { name: 'X' })).rejects.toThrow(NotFoundException);
      expect(dataSource.transaction).not.toHaveBeenCalled();
    });

    it('renames the category and regenerates its slug', async () => {
      const { service, repo, txCategoryRepo } = createService();
      repo.findOneBy.mockResolvedValue(stored());
      txCategoryRepo.findOne.mockResolvedValue(stored());

      const category = await service.update(COMPANY, 'category-1', { name: 'Tenis' });

      expect(category.name).toBe('Tenis');
      expect(category.slug).toBe('tenis');
    });

    it('moves it under a new parent of the same company', async () => {
      const { service, repo, txCategoryRepo } = createService();
      repo.findOneBy.mockResolvedValue(stored());
      txCategoryRepo.findOne.mockResolvedValue(stored());
      txCategoryRepo.existsBy.mockResolvedValueOnce(true); // el padre nuevo sí existe en la empresa

      const category = await service.update(COMPANY, 'category-1', { parentId: 'parent-1' });

      expect(category.parentId).toBe('parent-1');
    });

    it('clears the parent with null: it becomes a root category', async () => {
      const { service, repo, txCategoryRepo } = createService();
      repo.findOneBy.mockResolvedValue(stored({ parentId: 'parent-1' }));
      txCategoryRepo.findOne.mockResolvedValue(stored({ parentId: 'parent-1' }));

      const category = await service.update(COMPANY, 'category-1', { parentId: null });

      expect(category.parentId).toBeNull();
    });

    it('rejects a category as its own parent', async () => {
      const { service, repo, txCategoryRepo } = createService();
      repo.findOneBy.mockResolvedValue(stored());
      txCategoryRepo.findOne.mockResolvedValue(stored());

      await expect(
        service.update(COMPANY, 'category-1', { parentId: 'category-1' }),
      ).rejects.toThrow(BadRequestException);
      expect(txCategoryRepo.save).not.toHaveBeenCalled();
    });

    it('rejects a new parent that does not exist in the company', async () => {
      const { service, repo, txCategoryRepo } = createService();
      repo.findOneBy.mockResolvedValue(stored());
      txCategoryRepo.findOne.mockResolvedValue(stored());
      txCategoryRepo.existsBy.mockResolvedValue(false);

      await expect(
        service.update(COMPANY, 'category-1', { parentId: 'parent-9' }),
      ).rejects.toThrow(NotFoundException);
      expect(txCategoryRepo.save).not.toHaveBeenCalled();
    });

    it('does not let a category move inside one of its own subcategories, so it never gets stuck below itself', async () => {
      const { service, repo, txCategoryRepo, manager } = createService();
      repo.findOneBy.mockResolvedValue(stored());
      txCategoryRepo.findOne.mockResolvedValue(stored());
      txCategoryRepo.existsBy.mockResolvedValue(true); // el candidato a padre sí existe en la empresa
      manager.query = vi.fn(async (sql: string) =>
        sql.includes('WITH RECURSIVE') ? [{ '?column?': 1 }] : claimKey(sql),
      );

      await expect(
        service.update(COMPANY, 'category-1', { parentId: 'child-of-category-1' }),
      ).rejects.toThrow(BadRequestException);
      expect(txCategoryRepo.save).not.toHaveBeenCalled();
    });

    it('does not touch the parent or the slug when neither is sent', async () => {
      const { service, repo, txCategoryRepo } = createService();
      repo.findOneBy.mockResolvedValue(stored({ parentId: 'parent-1' }));
      txCategoryRepo.findOne.mockResolvedValue(stored({ parentId: 'parent-1' }));

      const category = await service.update(COMPANY, 'category-1', { description: 'Nueva' });

      expect(category.parentId).toBe('parent-1');
      expect(category.slug).toBe('zapatos-deportivos');
      expect(category.description).toBe('Nueva');
    });

    it('clears the description with null', async () => {
      const { service, repo, txCategoryRepo } = createService();
      repo.findOneBy.mockResolvedValue(stored({ description: 'Vieja' }));
      txCategoryRepo.findOne.mockResolvedValue(stored({ description: 'Vieja' }));

      const category = await service.update(COMPANY, 'category-1', { description: null });

      expect(category.description).toBeNull();
    });

    it('locks the category it changes, so it does not undo what somebody else changed meanwhile', async () => {
      const { service, repo, txCategoryRepo } = createService();
      repo.findOneBy.mockResolvedValue(stored());
      txCategoryRepo.findOne.mockResolvedValue(stored({ status: RecordStatus.INACTIVE }));

      const category = await service.update(COMPANY, 'category-1', { name: 'Tenis' });

      expect(txCategoryRepo.findOne).toHaveBeenCalledWith({
        where: { id: 'category-1', companyId: COMPANY },
        lock: { mode: 'pessimistic_write' },
      });
      expect(category.status).toBe(RecordStatus.INACTIVE);
    });
  });

  describe('deactivate', () => {
    it('deactivates a category with no active subcategories', async () => {
      const { service, repo, txCategoryRepo, dataSource } = createService();
      repo.findOneBy.mockResolvedValue({ id: 'category-1', status: RecordStatus.ACTIVE });
      txCategoryRepo.findOne.mockResolvedValue({ id: 'category-1', status: RecordStatus.ACTIVE });
      txCategoryRepo.existsBy.mockResolvedValue(false);

      const category = await service.deactivate(COMPANY, 'category-1');

      expect(dataSource.transaction).toHaveBeenCalled();
      expect(category.status).toBe(RecordStatus.INACTIVE);
    });

    it('refuses while it still has an active subcategory', async () => {
      const { service, repo, txCategoryRepo } = createService();
      repo.findOneBy.mockResolvedValue({ id: 'category-1', name: 'Zapatos', status: RecordStatus.ACTIVE });
      txCategoryRepo.findOne.mockResolvedValue({
        id: 'category-1',
        name: 'Zapatos',
        status: RecordStatus.ACTIVE,
      });
      txCategoryRepo.existsBy.mockResolvedValue(true);

      await expect(service.deactivate(COMPANY, 'category-1')).rejects.toThrow(ConflictException);
      expect(txCategoryRepo.existsBy).toHaveBeenCalledWith({
        companyId: COMPANY,
        parentId: 'category-1',
        status: RecordStatus.ACTIVE,
      });
      expect(txCategoryRepo.save).not.toHaveBeenCalled();
    });

    it('cannot reach a category of another company', async () => {
      const { service, repo, dataSource } = createService();
      repo.findOneBy.mockResolvedValue(null);

      await expect(service.deactivate(COMPANY, 'missing')).rejects.toThrow(NotFoundException);
      expect(dataSource.transaction).not.toHaveBeenCalled();
    });
  });

  describe('activate', () => {
    it('puts a category back in service without checking its parent or children', async () => {
      const { service, repo, txCategoryRepo, dataSource } = createService();
      repo.findOneBy.mockResolvedValue({ id: 'category-1', status: RecordStatus.INACTIVE });
      txCategoryRepo.findOne.mockResolvedValue({ id: 'category-1', status: RecordStatus.INACTIVE });

      const category = await service.activate(COMPANY, 'category-1');

      expect(dataSource.transaction).toHaveBeenCalled();
      expect(category.status).toBe(RecordStatus.ACTIVE);
      expect(txCategoryRepo.existsBy).not.toHaveBeenCalled();
    });
  });
});
