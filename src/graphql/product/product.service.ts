import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, EntityManager, Not, Repository } from 'typeorm';
import { RecordStatus } from '../../common/enums/record-status.enum.js';
import { definedFields } from '../../common/utils/defined-fields.js';
import { Brand } from '../brand/entities/brand.entity.js';
import { Category } from '../category/entities/category.entity.js';
import { runIdempotent } from '../idempotency/idempotency.js';
import { ProductVariant } from '../product-variant/entities/product-variant.entity.js';
import { CreateProductInput } from './dto/create-product.input.js';
import { UpdateProductInput } from './dto/update-product.input.js';
import { Product } from './entities/product.entity.js';

export interface ProductFilter {
  status?: RecordStatus;
  categoryId?: string;
  brandId?: string;
}

// Todo se hace dentro de la empresa activa: un producto de otra empresa se responde igual que uno
// que no existe. La marca es del catálogo compartido (ver brand.service.ts): se comprueba que
// exista, pero no que sea de esta empresa (no lo es de nadie en particular).
@Injectable()
export class ProductService {
  constructor(
    @InjectRepository(Product)
    private readonly productRepository: Repository<Product>,
    private readonly dataSource: DataSource,
  ) {}

  findAll(companyId: string, filter: ProductFilter = {}): Promise<Product[]> {
    return this.productRepository.find({
      where: {
        companyId,
        ...(filter.status && { status: filter.status }),
        ...(filter.categoryId && { categoryId: filter.categoryId }),
        ...(filter.brandId && { brandId: filter.brandId }),
      },
      order: { name: 'ASC' },
    });
  }

  async findOne(companyId: string, id: string): Promise<Product> {
    const product = await this.productRepository.findOneBy({ id, companyId });
    if (!product) throw new NotFoundException(`Producto ${id} no encontrado`);
    return product;
  }

  async create(
    companyId: string,
    userId: string,
    input: CreateProductInput,
    idempotencyKey?: string,
  ): Promise<Product> {
    return this.dataSource.transaction((manager) =>
      runIdempotent(
        manager,
        {
          companyId,
          userId,
          operation: 'createProduct',
          key: idempotencyKey,
          input,
          resourceType: 'product',
        },
        async () => {
          await this.assertCategory(manager, companyId, input.categoryId);
          if (input.brandId) await this.assertBrand(manager, input.brandId);
          await this.assertReferenceFree(manager, companyId, input.reference);

          const repo = manager.getRepository(Product);
          return repo.save(
            repo.create({
              companyId,
              categoryId: input.categoryId,
              brandId: input.brandId ?? null,
              name: input.name,
              reference: input.reference,
              description: input.description ?? null,
            }),
          );
        },
        (id) => manager.getRepository(Product).findOneByOrFail({ id }),
      ),
    );
  }

  async update(companyId: string, id: string, input: UpdateProductInput): Promise<Product> {
    await this.findOne(companyId, id);

    return this.dataSource.transaction(async (manager) => {
      const product = await this.lock(manager, companyId, id);
      const changes = definedFields(input);

      if (changes.categoryId !== undefined && changes.categoryId !== product.categoryId) {
        await this.assertCategory(manager, companyId, changes.categoryId);
        product.categoryId = changes.categoryId;
      }
      if (changes.brandId !== undefined && changes.brandId !== product.brandId) {
        if (changes.brandId) await this.assertBrand(manager, changes.brandId);
        product.brandId = changes.brandId;
      }
      if (changes.reference !== undefined && changes.reference !== product.reference) {
        await this.assertReferenceFree(manager, companyId, changes.reference, product.id);
        product.reference = changes.reference;
      }
      if (changes.name !== undefined) product.name = changes.name;
      if (changes.description !== undefined) product.description = changes.description;

      return manager.getRepository(Product).save(product);
    });
  }

  // Un producto con variantes activas no se desactiva: quedarían vendibles bajo un producto que ya
  // no aparece en el catálogo. Se desactivan primero ellas, o este se deja como está.
  async deactivate(companyId: string, id: string): Promise<Product> {
    await this.findOne(companyId, id);

    return this.dataSource.transaction(async (manager) => {
      const product = await this.lock(manager, companyId, id);
      const hasActiveVariants = await manager.getRepository(ProductVariant).existsBy({
        productId: product.id,
        status: RecordStatus.ACTIVE,
      });
      if (hasActiveVariants) {
        throw new ConflictException(
          `El producto ${product.name} tiene variantes activas: desactívalas primero`,
        );
      }
      product.status = RecordStatus.INACTIVE;
      return manager.getRepository(Product).save(product);
    });
  }

  async activate(companyId: string, id: string): Promise<Product> {
    await this.findOne(companyId, id);
    return this.dataSource.transaction(async (manager) => {
      const product = await this.lock(manager, companyId, id);
      product.status = RecordStatus.ACTIVE;
      return manager.getRepository(Product).save(product);
    });
  }

  private async lock(manager: EntityManager, companyId: string, id: string): Promise<Product> {
    const product = await manager
      .getRepository(Product)
      .findOne({ where: { id, companyId }, lock: { mode: 'pessimistic_write' } });
    if (!product) throw new NotFoundException(`Producto ${id} no encontrado`);
    return product;
  }

  private async assertCategory(manager: EntityManager, companyId: string, categoryId: string): Promise<void> {
    const exists = await manager.getRepository(Category).existsBy({ id: categoryId, companyId });
    if (!exists) throw new NotFoundException(`Categoría ${categoryId} no encontrada`);
  }

  // La marca es del catálogo compartido: existir alcanza, no hace falta que sea "de" esta empresa.
  private async assertBrand(manager: EntityManager, brandId: string): Promise<void> {
    const exists = await manager.getRepository(Brand).existsBy({ id: brandId });
    if (!exists) throw new NotFoundException(`Marca ${brandId} no encontrada`);
  }

  private async assertReferenceFree(
    manager: EntityManager,
    companyId: string,
    reference: string,
    excludeId?: string,
  ): Promise<void> {
    const clash = await manager.getRepository(Product).existsBy({
      companyId,
      reference,
      ...(excludeId && { id: Not(excludeId) }),
    });
    if (clash) throw new ConflictException(`Ya existe un producto con la referencia "${reference}"`);
  }
}
