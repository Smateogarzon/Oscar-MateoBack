import { ConflictException, NotFoundException } from '@nestjs/common';
import { RecordStatus } from '../../common/enums/record-status.enum.js';
import { Brand } from '../brand/entities/brand.entity.js';
import { Category } from '../category/entities/category.entity.js';
import { IdempotencyKey } from '../idempotency/entities/idempotency-key.entity.js';
import { fingerprintOf } from '../idempotency/idempotency.js';
import { ProductVariant } from '../product-variant/entities/product-variant.entity.js';
import { ProductService } from './product.service.js';

const claimKey = (sql: string) =>
  sql.includes('INSERT INTO "idempotency_keys"') ? [{ id: 'claim-1' }] : [];

function createService() {
  const repo = { find: vi.fn().mockResolvedValue([]), findOneBy: vi.fn() };
  const txProductRepo = {
    create: vi.fn((value: unknown) => value),
    save: vi.fn(async (value: object) => ({ id: 'product-1', ...value })),
    findOne: vi.fn(),
    findOneByOrFail: vi.fn(),
    existsBy: vi.fn().mockResolvedValue(false),
  };
  const categoryRepo = { existsBy: vi.fn().mockResolvedValue(true) };
  const brandRepo = { existsBy: vi.fn().mockResolvedValue(true) };
  const variantRepo = { existsBy: vi.fn().mockResolvedValue(false) };
  const idempotencyRepo = { findOneBy: vi.fn().mockResolvedValue(null) };
  const manager = {
    getRepository: (entity: unknown) =>
      entity === Category
        ? categoryRepo
        : entity === Brand
          ? brandRepo
          : entity === ProductVariant
            ? variantRepo
            : entity === IdempotencyKey
              ? idempotencyRepo
              : txProductRepo,
    query: vi.fn(async (sql: string) => claimKey(sql)),
  };
  const dataSource = {
    transaction: vi.fn(async (fn: (manager: unknown) => unknown) => fn(manager)),
  };
  const service = new ProductService(repo as never, dataSource as never);
  return {
    service,
    repo,
    txProductRepo,
    categoryRepo,
    brandRepo,
    variantRepo,
    idempotencyRepo,
    manager,
    dataSource,
  };
}

const COMPANY = 'company-1';
const USER = 'user-1';
const input = { name: 'Tenis urbano', reference: 'REF-001', categoryId: 'category-1' };

describe('ProductService', () => {
  describe('findAll', () => {
    it('only lists the products of the company', async () => {
      const { service, repo } = createService();

      await service.findAll(COMPANY);

      expect(repo.find).toHaveBeenCalledWith({ where: { companyId: COMPANY }, order: { name: 'ASC' } });
    });

    it('can narrow the list down by status, category or brand', async () => {
      const { service, repo } = createService();

      await service.findAll(COMPANY, { status: RecordStatus.ACTIVE, categoryId: 'category-1', brandId: 'brand-1' });

      expect(repo.find).toHaveBeenCalledWith({
        where: {
          companyId: COMPANY,
          status: RecordStatus.ACTIVE,
          categoryId: 'category-1',
          brandId: 'brand-1',
        },
        order: { name: 'ASC' },
      });
    });
  });

  describe('findOne', () => {
    it('looks the product up inside the company', async () => {
      const { service, repo } = createService();
      repo.findOneBy.mockResolvedValue(null);

      await expect(service.findOne(COMPANY, 'missing')).rejects.toThrow(NotFoundException);
      expect(repo.findOneBy).toHaveBeenCalledWith({ id: 'missing', companyId: COMPANY });
    });
  });

  describe('create', () => {
    it('creates a product with no brand', async () => {
      const { service, txProductRepo } = createService();

      const product = await service.create(COMPANY, USER, input);

      expect(txProductRepo.create).toHaveBeenCalledWith({
        companyId: COMPANY,
        categoryId: 'category-1',
        brandId: null,
        name: 'Tenis urbano',
        reference: 'REF-001',
        description: null,
      });
      expect(product.id).toBe('product-1');
    });

    it('rejects a category of another company (or one that does not exist)', async () => {
      const { service, categoryRepo, txProductRepo } = createService();
      categoryRepo.existsBy.mockResolvedValue(false);

      await expect(service.create(COMPANY, USER, input)).rejects.toThrow(NotFoundException);
      expect(txProductRepo.save).not.toHaveBeenCalled();
    });

    it('accepts a brand of the shared catalog', async () => {
      const { service, brandRepo, txProductRepo } = createService();

      await service.create(COMPANY, USER, { ...input, brandId: 'brand-1' });

      expect(brandRepo.existsBy).toHaveBeenCalledWith({ id: 'brand-1' });
      expect(txProductRepo.create.mock.calls[0][0]).toMatchObject({ brandId: 'brand-1' });
    });

    it('rejects a brand that does not exist', async () => {
      const { service, brandRepo, txProductRepo } = createService();
      brandRepo.existsBy.mockResolvedValue(false);

      await expect(service.create(COMPANY, USER, { ...input, brandId: 'brand-9' })).rejects.toThrow(
        NotFoundException,
      );
      expect(txProductRepo.save).not.toHaveBeenCalled();
    });

    it('rejects a reference that already exists in the company', async () => {
      const { service, txProductRepo } = createService();
      txProductRepo.existsBy.mockResolvedValue(true);

      await expect(service.create(COMPANY, USER, input)).rejects.toThrow(ConflictException);
      expect(txProductRepo.save).not.toHaveBeenCalled();
    });

    describe('with an idempotency key', () => {
      it('claims the key in the same transaction as the creation, before saving anything', async () => {
        const { service, manager, dataSource, txProductRepo } = createService();

        await service.create(COMPANY, USER, input, 'key-1');

        expect(dataSource.transaction).toHaveBeenCalledTimes(1);
        expect(manager.query).toHaveBeenNthCalledWith(
          1,
          expect.stringContaining('INSERT INTO "idempotency_keys"'),
          [COMPANY, USER, 'createProduct', 'key-1', fingerprintOf(input)],
        );
        expect(manager.query.mock.invocationCallOrder[0]).toBeLessThan(
          txProductRepo.save.mock.invocationCallOrder[0],
        );
      });

      it('a repeated request gets back the same product, without creating another', async () => {
        const { service, manager, idempotencyRepo, txProductRepo } = createService();
        manager.query = vi.fn(async () => []);
        idempotencyRepo.findOneBy.mockResolvedValue({
          fingerprint: fingerprintOf(input),
          resourceId: 'product-1',
        });
        txProductRepo.findOneByOrFail.mockResolvedValue({ id: 'product-1', ...input });

        const product = await service.create(COMPANY, USER, input, 'key-1');

        expect(product.id).toBe('product-1');
        expect(txProductRepo.save).not.toHaveBeenCalled();
      });
    });
  });

  describe('update', () => {
    const stored = (overrides: Record<string, unknown> = {}) => ({
      id: 'product-1',
      companyId: COMPANY,
      categoryId: 'category-1',
      brandId: null,
      name: 'Tenis urbano',
      reference: 'REF-001',
      description: null,
      status: RecordStatus.ACTIVE,
      ...overrides,
    });

    it('cannot reach a product of another company', async () => {
      const { service, repo, dataSource } = createService();
      repo.findOneBy.mockResolvedValue(null);

      await expect(service.update(COMPANY, 'missing', { name: 'X' })).rejects.toThrow(NotFoundException);
      expect(dataSource.transaction).not.toHaveBeenCalled();
    });

    it('moves it to a new category of the same company', async () => {
      const { service, repo, txProductRepo } = createService();
      repo.findOneBy.mockResolvedValue(stored());
      txProductRepo.findOne.mockResolvedValue(stored());

      const product = await service.update(COMPANY, 'product-1', { categoryId: 'category-2' });

      expect(product.categoryId).toBe('category-2');
    });

    it('rejects a new category that does not exist in the company', async () => {
      const { service, repo, txProductRepo, categoryRepo } = createService();
      repo.findOneBy.mockResolvedValue(stored());
      txProductRepo.findOne.mockResolvedValue(stored());
      categoryRepo.existsBy.mockResolvedValue(false);

      await expect(
        service.update(COMPANY, 'product-1', { categoryId: 'category-9' }),
      ).rejects.toThrow(NotFoundException);
      expect(txProductRepo.save).not.toHaveBeenCalled();
    });

    it('sets and then clears the brand with null', async () => {
      const { service, repo, txProductRepo } = createService();
      repo.findOneBy.mockResolvedValue(stored());
      txProductRepo.findOne.mockResolvedValue(stored());

      const withBrand = await service.update(COMPANY, 'product-1', { brandId: 'brand-1' });
      expect(withBrand.brandId).toBe('brand-1');

      txProductRepo.findOne.mockResolvedValue(stored({ brandId: 'brand-1' }));
      const cleared = await service.update(COMPANY, 'product-1', { brandId: null });
      expect(cleared.brandId).toBeNull();
    });

    it('rejects a rename of the reference to one already used in the company', async () => {
      const { service, repo, txProductRepo } = createService();
      repo.findOneBy.mockResolvedValue(stored());
      txProductRepo.findOne.mockResolvedValue(stored());
      txProductRepo.existsBy.mockResolvedValue(true);

      await expect(
        service.update(COMPANY, 'product-1', { reference: 'REF-002' }),
      ).rejects.toThrow(ConflictException);
      expect(txProductRepo.save).not.toHaveBeenCalled();
    });

    it('clears the description with null', async () => {
      const { service, repo, txProductRepo } = createService();
      repo.findOneBy.mockResolvedValue(stored({ description: 'Vieja' }));
      txProductRepo.findOne.mockResolvedValue(stored({ description: 'Vieja' }));

      const product = await service.update(COMPANY, 'product-1', { description: null });

      expect(product.description).toBeNull();
    });

    it('locks the product it changes, so it does not undo what somebody else changed meanwhile', async () => {
      const { service, repo, txProductRepo } = createService();
      repo.findOneBy.mockResolvedValue(stored());
      txProductRepo.findOne.mockResolvedValue(stored({ status: RecordStatus.INACTIVE }));

      const product = await service.update(COMPANY, 'product-1', { name: 'Tenis casual' });

      expect(txProductRepo.findOne).toHaveBeenCalledWith({
        where: { id: 'product-1', companyId: COMPANY },
        lock: { mode: 'pessimistic_write' },
      });
      expect(product.status).toBe(RecordStatus.INACTIVE);
    });
  });

  describe('deactivate', () => {
    it('deactivates a product with no active variants', async () => {
      const { service, repo, txProductRepo, dataSource } = createService();
      repo.findOneBy.mockResolvedValue({ id: 'product-1', status: RecordStatus.ACTIVE });
      txProductRepo.findOne.mockResolvedValue({ id: 'product-1', status: RecordStatus.ACTIVE });

      const product = await service.deactivate(COMPANY, 'product-1');

      expect(dataSource.transaction).toHaveBeenCalled();
      expect(product.status).toBe(RecordStatus.INACTIVE);
    });

    it('refuses while it still has an active variant', async () => {
      const { service, repo, txProductRepo, variantRepo } = createService();
      repo.findOneBy.mockResolvedValue({ id: 'product-1', name: 'Tenis urbano', status: RecordStatus.ACTIVE });
      txProductRepo.findOne.mockResolvedValue({
        id: 'product-1',
        name: 'Tenis urbano',
        status: RecordStatus.ACTIVE,
      });
      variantRepo.existsBy.mockResolvedValue(true);

      await expect(service.deactivate(COMPANY, 'product-1')).rejects.toThrow(ConflictException);
      expect(variantRepo.existsBy).toHaveBeenCalledWith({
        productId: 'product-1',
        status: RecordStatus.ACTIVE,
      });
      expect(txProductRepo.save).not.toHaveBeenCalled();
    });
  });

  describe('activate', () => {
    it('puts a product back in service without checking its variants', async () => {
      const { service, repo, txProductRepo, variantRepo, dataSource } = createService();
      repo.findOneBy.mockResolvedValue({ id: 'product-1', status: RecordStatus.INACTIVE });
      txProductRepo.findOne.mockResolvedValue({ id: 'product-1', status: RecordStatus.INACTIVE });

      const product = await service.activate(COMPANY, 'product-1');

      expect(dataSource.transaction).toHaveBeenCalled();
      expect(product.status).toBe(RecordStatus.ACTIVE);
      expect(variantRepo.existsBy).not.toHaveBeenCalled();
    });
  });
});
