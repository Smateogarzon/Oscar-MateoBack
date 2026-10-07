import { ConflictException, NotFoundException } from '@nestjs/common';
import { RecordStatus } from '../../common/enums/record-status.enum.js';
import { Color } from '../color/entities/color.entity.js';
import { IdempotencyKey } from '../idempotency/entities/idempotency-key.entity.js';
import { fingerprintOf } from '../idempotency/idempotency.js';
import { Product } from '../product/entities/product.entity.js';
import { Size } from '../size/entities/size.entity.js';
import { ProductVariantService } from './product-variant.service.js';

const claimKey = (sql: string) =>
  sql.includes('INSERT INTO "idempotency_keys"') ? [{ id: 'claim-1' }] : [];

function createService() {
  const repo = { find: vi.fn().mockResolvedValue([]), findOneBy: vi.fn() };
  const txVariantRepo = {
    create: vi.fn((value: unknown) => value),
    save: vi.fn(async (value: object) => ({ id: 'variant-1', ...value })),
    findOne: vi.fn(),
    findOneByOrFail: vi.fn(),
    existsBy: vi.fn().mockResolvedValue(false),
  };
  const productRepo = { existsBy: vi.fn().mockResolvedValue(true) };
  const colorRepo = { existsBy: vi.fn().mockResolvedValue(true) };
  const sizeRepo = { existsBy: vi.fn().mockResolvedValue(true) };
  const idempotencyRepo = { findOneBy: vi.fn().mockResolvedValue(null) };
  const manager = {
    getRepository: (entity: unknown) =>
      entity === Product
        ? productRepo
        : entity === Color
          ? colorRepo
          : entity === Size
            ? sizeRepo
            : entity === IdempotencyKey
              ? idempotencyRepo
              : txVariantRepo,
    query: vi.fn(async (sql: string) => claimKey(sql)),
  };
  const dataSource = {
    transaction: vi.fn(async (fn: (manager: unknown) => unknown) => fn(manager)),
  };
  const service = new ProductVariantService(repo as never, dataSource as never);
  return {
    service,
    repo,
    txVariantRepo,
    productRepo,
    colorRepo,
    sizeRepo,
    idempotencyRepo,
    manager,
    dataSource,
  };
}

const COMPANY = 'company-1';
const USER = 'user-1';
const input = {
  productId: 'product-1',
  colorId: 'color-1',
  sizeId: 'size-1',
  sku: 'ZAP-001-ROJ-38',
  cost: '35000',
  price: '89900',
};

describe('ProductVariantService', () => {
  describe('findAll', () => {
    it('only lists the variants of the company', async () => {
      const { service, repo } = createService();

      await service.findAll(COMPANY);

      expect(repo.find).toHaveBeenCalledWith({ where: { companyId: COMPANY }, order: { sku: 'ASC' } });
    });

    it('can narrow the list down to one product', async () => {
      const { service, repo } = createService();

      await service.findAll(COMPANY, { productId: 'product-1' });

      expect(repo.find).toHaveBeenCalledWith({
        where: { companyId: COMPANY, productId: 'product-1' },
        order: { sku: 'ASC' },
      });
    });
  });

  describe('findOne', () => {
    it('looks the variant up inside the company', async () => {
      const { service, repo } = createService();
      repo.findOneBy.mockResolvedValue(null);

      await expect(service.findOne(COMPANY, 'missing')).rejects.toThrow(NotFoundException);
    });
  });

  describe('create', () => {
    it('creates the variant, with cost and price as Decimal', async () => {
      const { service, txVariantRepo } = createService();

      const variant = await service.create(COMPANY, USER, input);

      const created = txVariantRepo.create.mock.calls[0][0];
      expect(created).toMatchObject({
        companyId: COMPANY,
        productId: 'product-1',
        colorId: 'color-1',
        sizeId: 'size-1',
        sku: 'ZAP-001-ROJ-38',
        imageUrl: null,
      });
      expect(created.cost.toFixed(2)).toBe('35000.00');
      expect(created.price.toFixed(2)).toBe('89900.00');
      expect(variant.id).toBe('variant-1');
    });

    it('rejects a product of another company (or one that does not exist)', async () => {
      const { service, productRepo, txVariantRepo } = createService();
      productRepo.existsBy.mockResolvedValue(false);

      await expect(service.create(COMPANY, USER, input)).rejects.toThrow(NotFoundException);
      expect(txVariantRepo.save).not.toHaveBeenCalled();
    });

    it('rejects a color that does not exist', async () => {
      const { service, colorRepo, txVariantRepo } = createService();
      colorRepo.existsBy.mockResolvedValue(false);

      await expect(service.create(COMPANY, USER, input)).rejects.toThrow(NotFoundException);
      expect(txVariantRepo.save).not.toHaveBeenCalled();
    });

    it('rejects a size that does not exist', async () => {
      const { service, sizeRepo, txVariantRepo } = createService();
      sizeRepo.existsBy.mockResolvedValue(false);

      await expect(service.create(COMPANY, USER, input)).rejects.toThrow(NotFoundException);
      expect(txVariantRepo.save).not.toHaveBeenCalled();
    });

    it('rejects a SKU that already exists in the company', async () => {
      const { service, txVariantRepo } = createService();
      txVariantRepo.existsBy.mockResolvedValueOnce(true);

      await expect(service.create(COMPANY, USER, input)).rejects.toThrow(ConflictException);
      expect(txVariantRepo.save).not.toHaveBeenCalled();
    });

    it('rejects a second variant of the same product with the same color and size', async () => {
      const { service, txVariantRepo } = createService();
      // 1ª existsBy: el SKU está libre. 2ª: el color y la talla ya tienen variante en este producto.
      txVariantRepo.existsBy.mockResolvedValueOnce(false).mockResolvedValueOnce(true);

      await expect(service.create(COMPANY, USER, input)).rejects.toThrow(ConflictException);
      expect(txVariantRepo.save).not.toHaveBeenCalled();
    });

    it('keeps no image when none comes with it', async () => {
      const { service, txVariantRepo } = createService();

      await service.create(COMPANY, USER, input);

      expect(txVariantRepo.create.mock.calls[0][0]).toMatchObject({ imageUrl: null });
    });

    describe('with an idempotency key', () => {
      it('claims the key in the same transaction as the creation, before saving anything', async () => {
        const { service, manager, dataSource, txVariantRepo } = createService();

        await service.create(COMPANY, USER, input, 'key-1');

        expect(dataSource.transaction).toHaveBeenCalledTimes(1);
        expect(manager.query).toHaveBeenNthCalledWith(
          1,
          expect.stringContaining('INSERT INTO "idempotency_keys"'),
          [COMPANY, USER, 'createProductVariant', 'key-1', fingerprintOf(input)],
        );
        expect(manager.query.mock.invocationCallOrder[0]).toBeLessThan(
          txVariantRepo.save.mock.invocationCallOrder[0],
        );
      });

      it('a repeated request gets back the same variant, without creating another', async () => {
        const { service, manager, idempotencyRepo, txVariantRepo } = createService();
        manager.query = vi.fn(async () => []);
        idempotencyRepo.findOneBy.mockResolvedValue({
          fingerprint: fingerprintOf(input),
          resourceId: 'variant-1',
        });
        txVariantRepo.findOneByOrFail.mockResolvedValue({ id: 'variant-1', ...input });

        const variant = await service.create(COMPANY, USER, input, 'key-1');

        expect(variant.id).toBe('variant-1');
        expect(txVariantRepo.save).not.toHaveBeenCalled();
      });
    });
  });

  describe('update', () => {
    const stored = (overrides: Record<string, unknown> = {}) => ({
      id: 'variant-1',
      companyId: COMPANY,
      productId: 'product-1',
      colorId: 'color-1',
      sizeId: 'size-1',
      sku: 'ZAP-001-ROJ-38',
      imageUrl: null,
      status: RecordStatus.ACTIVE,
      ...overrides,
    });

    it('cannot reach a variant of another company', async () => {
      const { service, repo, dataSource } = createService();
      repo.findOneBy.mockResolvedValue(null);

      await expect(service.update(COMPANY, 'missing', { sku: 'X' })).rejects.toThrow(NotFoundException);
      expect(dataSource.transaction).not.toHaveBeenCalled();
    });

    it('changes cost and price, converted to Decimal', async () => {
      const { service, repo, txVariantRepo } = createService();
      repo.findOneBy.mockResolvedValue(stored());
      txVariantRepo.findOne.mockResolvedValue(stored());

      const variant = await service.update(COMPANY, 'variant-1', { cost: '36000', price: '92000' });

      expect(variant.cost.toFixed(2)).toBe('36000.00');
      expect(variant.price.toFixed(2)).toBe('92000.00');
    });

    it('moves it to a different color and size, once both are free', async () => {
      const { service, repo, txVariantRepo } = createService();
      repo.findOneBy.mockResolvedValue(stored());
      txVariantRepo.findOne.mockResolvedValue(stored());

      const variant = await service.update(COMPANY, 'variant-1', { colorId: 'color-2', sizeId: 'size-2' });

      expect(variant.colorId).toBe('color-2');
      expect(variant.sizeId).toBe('size-2');
    });

    it('rejects a color/size combination the product already has in another variant', async () => {
      const { service, repo, txVariantRepo } = createService();
      repo.findOneBy.mockResolvedValue(stored());
      txVariantRepo.findOne.mockResolvedValue(stored());
      txVariantRepo.existsBy.mockResolvedValue(true);

      await expect(
        service.update(COMPANY, 'variant-1', { colorId: 'color-2' }),
      ).rejects.toThrow(ConflictException);
      expect(txVariantRepo.save).not.toHaveBeenCalled();
    });

    it('does not re-check the combination when neither color nor size change', async () => {
      const { service, repo, txVariantRepo } = createService();
      repo.findOneBy.mockResolvedValue(stored());
      txVariantRepo.findOne.mockResolvedValue(stored());

      await service.update(COMPANY, 'variant-1', { sku: 'ZAP-001-ROJ-39' });

      // El único existsBy de esta prueba es el del SKU nuevo, no el de la combinación.
      expect(txVariantRepo.existsBy).toHaveBeenCalledTimes(1);
    });

    it('rejects a SKU already used by another variant of the company', async () => {
      const { service, repo, txVariantRepo } = createService();
      repo.findOneBy.mockResolvedValue(stored());
      txVariantRepo.findOne.mockResolvedValue(stored());
      txVariantRepo.existsBy.mockResolvedValue(true);

      await expect(
        service.update(COMPANY, 'variant-1', { sku: 'ZAP-002-AZU-40' }),
      ).rejects.toThrow(ConflictException);
      expect(txVariantRepo.save).not.toHaveBeenCalled();
    });

    it('clears the image with null', async () => {
      const { service, repo, txVariantRepo } = createService();
      repo.findOneBy.mockResolvedValue(stored({ imageUrl: 'https://cdn.example.com/x.png' }));
      txVariantRepo.findOne.mockResolvedValue(stored({ imageUrl: 'https://cdn.example.com/x.png' }));

      const variant = await service.update(COMPANY, 'variant-1', { imageUrl: null });

      expect(variant.imageUrl).toBeNull();
    });

    it('locks the variant it changes, so it does not undo what somebody else changed meanwhile', async () => {
      const { service, repo, txVariantRepo } = createService();
      repo.findOneBy.mockResolvedValue(stored());
      txVariantRepo.findOne.mockResolvedValue(stored({ status: RecordStatus.INACTIVE }));

      const variant = await service.update(COMPANY, 'variant-1', { sku: 'ZAP-001-ROJ-39' });

      expect(txVariantRepo.findOne).toHaveBeenCalledWith({
        where: { id: 'variant-1', companyId: COMPANY },
        lock: { mode: 'pessimistic_write' },
      });
      expect(variant.status).toBe(RecordStatus.INACTIVE);
    });
  });

  describe('deactivate', () => {
    it('deactivates a variant inside a transaction', async () => {
      const { service, repo, txVariantRepo, dataSource } = createService();
      repo.findOneBy.mockResolvedValue({ id: 'variant-1', status: RecordStatus.ACTIVE });
      txVariantRepo.findOne.mockResolvedValue({ id: 'variant-1', status: RecordStatus.ACTIVE });

      const variant = await service.deactivate(COMPANY, 'variant-1');

      expect(dataSource.transaction).toHaveBeenCalled();
      expect(variant.status).toBe(RecordStatus.INACTIVE);
    });
  });

  describe('activate', () => {
    it('puts a variant back in service inside a transaction', async () => {
      const { service, repo, txVariantRepo, dataSource } = createService();
      repo.findOneBy.mockResolvedValue({ id: 'variant-1', status: RecordStatus.INACTIVE });
      txVariantRepo.findOne.mockResolvedValue({ id: 'variant-1', status: RecordStatus.INACTIVE });

      const variant = await service.activate(COMPANY, 'variant-1');

      expect(dataSource.transaction).toHaveBeenCalled();
      expect(variant.status).toBe(RecordStatus.ACTIVE);
    });
  });
});
