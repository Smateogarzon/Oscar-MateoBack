import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Decimal } from 'decimal.js';
import { DataSource, EntityManager, Not, Repository } from 'typeorm';
import { RecordStatus } from '../../common/enums/record-status.enum.js';
import { definedFields } from '../../common/utils/defined-fields.js';
import { Color } from '../color/entities/color.entity.js';
import { runIdempotent } from '../idempotency/idempotency.js';
import { Product } from '../product/entities/product.entity.js';
import { Size } from '../size/entities/size.entity.js';
import { CreateProductVariantInput } from './dto/create-product-variant.input.js';
import { UpdateProductVariantInput } from './dto/update-product-variant.input.js';
import { ProductVariant } from './entities/product-variant.entity.js';

export interface ProductVariantFilter {
  productId?: string;
  status?: RecordStatus;
}

// La unidad que de verdad se vende (ver product-variant.entity.ts). Todo se hace dentro de la
// empresa activa: color y talla son del catálogo compartido (existir alcanza), producto tiene que
// ser de esta empresa.
@Injectable()
export class ProductVariantService {
  constructor(
    @InjectRepository(ProductVariant)
    private readonly variantRepository: Repository<ProductVariant>,
    private readonly dataSource: DataSource,
  ) {}

  findAll(companyId: string, filter: ProductVariantFilter = {}): Promise<ProductVariant[]> {
    return this.variantRepository.find({
      where: {
        companyId,
        ...(filter.productId && { productId: filter.productId }),
        ...(filter.status && { status: filter.status }),
      },
      order: { sku: 'ASC' },
    });
  }

  async findOne(companyId: string, id: string): Promise<ProductVariant> {
    const variant = await this.variantRepository.findOneBy({ id, companyId });
    if (!variant) throw new NotFoundException(`Variante ${id} no encontrada`);
    return variant;
  }

  async create(
    companyId: string,
    userId: string,
    input: CreateProductVariantInput,
    idempotencyKey?: string,
  ): Promise<ProductVariant> {
    return this.dataSource.transaction((manager) =>
      runIdempotent(
        manager,
        {
          companyId,
          userId,
          operation: 'createProductVariant',
          key: idempotencyKey,
          input,
          resourceType: 'productVariant',
        },
        async () => {
          await this.assertProduct(manager, companyId, input.productId);
          await this.assertColor(manager, input.colorId);
          await this.assertSize(manager, input.sizeId);
          await this.assertSkuFree(manager, companyId, input.sku);
          await this.assertComboFree(manager, input.productId, input.colorId, input.sizeId);

          const repo = manager.getRepository(ProductVariant);
          return repo.save(
            repo.create({
              companyId,
              productId: input.productId,
              colorId: input.colorId,
              sizeId: input.sizeId,
              sku: input.sku,
              cost: new Decimal(input.cost),
              price: new Decimal(input.price),
              imageUrl: input.imageUrl ?? null,
            }),
          );
        },
        (id) => manager.getRepository(ProductVariant).findOneByOrFail({ id }),
      ),
    );
  }

  async update(companyId: string, id: string, input: UpdateProductVariantInput): Promise<ProductVariant> {
    await this.findOne(companyId, id);

    return this.dataSource.transaction(async (manager) => {
      const variant = await this.lock(manager, companyId, id);
      const changes = definedFields(input);

      const nextColorId = changes.colorId ?? variant.colorId;
      const nextSizeId = changes.sizeId ?? variant.sizeId;
      if (changes.colorId !== undefined || changes.sizeId !== undefined) {
        if (changes.colorId !== undefined) await this.assertColor(manager, changes.colorId);
        if (changes.sizeId !== undefined) await this.assertSize(manager, changes.sizeId);
        if (nextColorId !== variant.colorId || nextSizeId !== variant.sizeId) {
          await this.assertComboFree(manager, variant.productId, nextColorId, nextSizeId, variant.id);
        }
        variant.colorId = nextColorId;
        variant.sizeId = nextSizeId;
      }

      if (changes.sku !== undefined && changes.sku !== variant.sku) {
        await this.assertSkuFree(manager, companyId, changes.sku, variant.id);
        variant.sku = changes.sku;
      }
      if (changes.cost !== undefined) variant.cost = new Decimal(changes.cost);
      if (changes.price !== undefined) variant.price = new Decimal(changes.price);
      if (changes.imageUrl !== undefined) variant.imageUrl = changes.imageUrl;

      return manager.getRepository(ProductVariant).save(variant);
    });
  }

  async deactivate(companyId: string, id: string): Promise<ProductVariant> {
    await this.findOne(companyId, id);
    return this.dataSource.transaction(async (manager) => {
      const variant = await this.lock(manager, companyId, id);
      variant.status = RecordStatus.INACTIVE;
      return manager.getRepository(ProductVariant).save(variant);
    });
  }

  async activate(companyId: string, id: string): Promise<ProductVariant> {
    await this.findOne(companyId, id);
    return this.dataSource.transaction(async (manager) => {
      const variant = await this.lock(manager, companyId, id);
      variant.status = RecordStatus.ACTIVE;
      return manager.getRepository(ProductVariant).save(variant);
    });
  }

  private async lock(manager: EntityManager, companyId: string, id: string): Promise<ProductVariant> {
    const variant = await manager
      .getRepository(ProductVariant)
      .findOne({ where: { id, companyId }, lock: { mode: 'pessimistic_write' } });
    if (!variant) throw new NotFoundException(`Variante ${id} no encontrada`);
    return variant;
  }

  private async assertProduct(manager: EntityManager, companyId: string, productId: string): Promise<void> {
    const exists = await manager.getRepository(Product).existsBy({ id: productId, companyId });
    if (!exists) throw new NotFoundException(`Producto ${productId} no encontrado`);
  }

  private async assertColor(manager: EntityManager, colorId: string): Promise<void> {
    const exists = await manager.getRepository(Color).existsBy({ id: colorId });
    if (!exists) throw new NotFoundException(`Color ${colorId} no encontrado`);
  }

  private async assertSize(manager: EntityManager, sizeId: string): Promise<void> {
    const exists = await manager.getRepository(Size).existsBy({ id: sizeId });
    if (!exists) throw new NotFoundException(`Talla ${sizeId} no encontrada`);
  }

  // El SKU es único de verdad (índice único en la tabla): esto no se puede "confirmar y crear
  // igual" como el nombre parecido de un producto (ver ProductService.assertNameNotSimilar). Lo
  // único que se hace acá es decir A QUIÉN pertenece ya ese SKU, para que quien lo escribió mal
  // encuentre la variante correcta en vez de intentar otro SKU al azar.
  private async assertSkuFree(
    manager: EntityManager,
    companyId: string,
    sku: string,
    excludeId?: string,
  ): Promise<void> {
    const clash = await manager.getRepository(ProductVariant).existsBy({
      companyId,
      sku,
      ...(excludeId && { id: Not(excludeId) }),
    });
    if (!clash) return;
    throw new ConflictException(await this.duplicateSkuError(manager, companyId, sku, excludeId));
  }

  // A quién pertenece ya el SKU, para el mensaje de assertSkuFree. Consulta aparte (con join a
  // products) porque el repositorio de variantes no trae la relación cargada por defecto; si por
  // lo que sea no encuentra el dueño, el mensaje cae a uno genérico en vez de romper.
  private async duplicateSkuError(
    manager: EntityManager,
    companyId: string,
    sku: string,
    excludeId?: string,
  ): Promise<Record<string, unknown>> {
    const rows: { variantId: string; productId: string; productName: string; productReference: string }[] =
      await manager.query(
        `SELECT pv.id AS "variantId", p.id AS "productId", p.name AS "productName", p.reference AS "productReference"
           FROM product_variants pv
           JOIN products p ON p.id = pv."productId"
          WHERE pv."companyId" = $1::uuid AND pv.sku = $2
          ${excludeId ? 'AND pv.id <> $3::uuid' : ''}
          LIMIT 1`,
        excludeId ? [companyId, sku, excludeId] : [companyId, sku],
      );
    const owner = rows[0];
    if (!owner) return { message: `Ya existe una variante con el SKU "${sku}"`, code: 'DUPLICATE_SKU' };
    return {
      message: `El SKU "${sku}" ya pertenece a "${owner.productName}" (referencia ${owner.productReference}). ¿Quisiste decir este producto?`,
      code: 'DUPLICATE_SKU',
      ...owner,
    };
  }

  // Este producto no puede tener dos variantes con el mismo color y la misma talla.
  private async assertComboFree(
    manager: EntityManager,
    productId: string,
    colorId: string,
    sizeId: string,
    excludeId?: string,
  ): Promise<void> {
    const clash = await manager.getRepository(ProductVariant).existsBy({
      productId,
      colorId,
      sizeId,
      ...(excludeId && { id: Not(excludeId) }),
    });
    if (clash) {
      throw new ConflictException('Este producto ya tiene una variante con ese color y esa talla');
    }
  }
}
