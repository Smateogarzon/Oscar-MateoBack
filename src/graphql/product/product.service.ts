import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, EntityManager, In, Not, Repository } from 'typeorm';
import { RecordStatus } from '../../common/enums/record-status.enum.js';
import { RoleCode } from '../../common/enums/role-code.enum.js';
import { definedFields } from '../../common/utils/defined-fields.js';
import { Brand } from '../brand/entities/brand.entity.js';
import { Category } from '../category/entities/category.entity.js';
import { runIdempotent } from '../idempotency/idempotency.js';
import { InventoryBalance } from '../inventory-balance/entities/inventory-balance.entity.js';
import { InventoryMovement } from '../inventory-movement/entities/inventory-movement.entity.js';
import { InventoryReservation } from '../inventory-reservation/entities/inventory-reservation.entity.js';
import { ProductVariant } from '../product-variant/entities/product-variant.entity.js';
import { CreateProductInput } from './dto/create-product.input.js';
import { UpdateProductInput } from './dto/update-product.input.js';
import { Product } from './entities/product.entity.js';

// Con este rol, "borrar" es un borrado real cuando la referencia está limpia (ver deleteReference).
const HARD_DELETE_ROLE = RoleCode.SUPER_ADMIN;

// Puntaje de similitud de trigramas (0 a 1) a partir del cual dos nombres se consideran "la
// misma referencia mal escrita". Elegido a mano probando con el caso real que lo motivó:
// "adiddas hair forse 1 opacas" contra "adidas air force one negras" da ~0.42.
const NAME_SIMILARITY_THRESHOLD = 0.35;
const MAX_SIMILAR_SUGGESTIONS = 5;

// pg_trgm se queda corto con nombres de una sola palabra corta: "samba" y "zamba" tienen tan
// pocos trigramas que cambiar una letra hunde el puntaje muy por debajo de NAME_SIMILARITY_THRESHOLD.
// Para nombres de hasta SHORT_NAME_MAX_LENGTH se refuerza con distancia de edición (levenshtein):
// se exige 1 sola letra de diferencia en nombres de hasta 5 caracteres, y 2 hasta el límite, para
// no marcar como "parecidos" pares cortos que en realidad son distintos (p. ej. "nike" / "vibe").
const SHORT_NAME_MAX_LENGTH = 8;
const SHORT_NAME_MAX_EDITS_TIGHT = 1;
const SHORT_NAME_MAX_EDITS_TIGHT_LENGTH = 5;
const SHORT_NAME_MAX_EDITS = 2;

export interface SimilarProductMatch {
  id: string;
  name: string;
  reference: string;
  score: number;
}

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
          if (!input.confirmDuplicate) await this.assertNameNotSimilar(manager, companyId, input.name);

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

  // "Eliminar referencia": desactiva el producto y todas sus variantes (a diferencia de
  // `deactivate`, que exige desactivarlas antes; acá se hace de una vez). Con el rol
  // SUPER_ADMIN y solo si la referencia nunca tuvo actividad (ningún movimiento ni reserva en
  // ninguna de sus variantes), en vez de desactivarla se borra de verdad — el único borrado real
  // de este backend, reservado a lo que nunca llegó a moverse; con historial, o sin ese rol, se
  // desactiva igual que para cualquier otro administrador.
  async deleteReference(companyId: string, roleCodes: readonly string[], id: string): Promise<Product> {
    await this.findOne(companyId, id);
    return this.dataSource.transaction((manager) => this.deleteReferenceWithin(manager, companyId, roleCodes, id));
  }

  // Misma operación, pero dentro de una transacción que ya abrió el llamador: así borrar la
  // referencia puede ir junto con otros cambios en una sola operación atómica.
  async deleteReferenceWithin(manager: EntityManager, companyId: string, roleCodes: readonly string[], id: string): Promise<Product> {
    const product = await this.lock(manager, companyId, id);
    const variantRepo = manager.getRepository(ProductVariant);
    const variants = await variantRepo.find({ where: { productId: product.id } });
    const variantIds = variants.map((variant) => variant.id);

    const canHardDelete = roleCodes.includes(HARD_DELETE_ROLE) && !(await this.hasActivity(manager, variantIds));
    if (canHardDelete) {
      if (variants.length > 0) {
        await manager.getRepository(InventoryBalance).delete({ productVariantId: In(variantIds) });
        await variantRepo.remove(variants);
      }
      // remove() le quita el id al objeto que recibe: se borra una copia para devolver el producto con su id.
      await manager.getRepository(Product).remove({ ...product });
      return product;
    }

    for (const variant of variants) variant.status = RecordStatus.INACTIVE;
    if (variants.length > 0) await variantRepo.save(variants);
    product.status = RecordStatus.INACTIVE;
    return manager.getRepository(Product).save(product);
  }

  // ¿Alguna variante tuvo alguna vez un movimiento o una reserva? Sin balanza no hace falta
  // comprobarla aparte: solo existe si hubo un movimiento que la creara.
  private async hasActivity(manager: EntityManager, variantIds: string[]): Promise<boolean> {
    if (variantIds.length === 0) return false;
    const [hasMovement, hasReservation] = await Promise.all([
      manager.getRepository(InventoryMovement).existsBy({ productVariantId: In(variantIds) }),
      manager.getRepository(InventoryReservation).existsBy({ productVariantId: In(variantIds) }),
    ]);
    return hasMovement || hasReservation;
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

  // Para el front: mientras el trabajador escribe el nombre, le muestra candidatos parecidos
  // antes de que llegue a intentar crear (mismo cálculo que el aviso de create(), pero sin
  // bloquear nada: es solo para autocompletar).
  findSimilarByName(companyId: string, name: string): Promise<SimilarProductMatch[]> {
    return this.findSimilarByNameWithin(this.dataSource.manager, companyId, name);
  }

  // pg_trgm compara por trigramas de letras, no por coincidencia exacta: "adiddas hair forse 1"
  // y "adidas air force one" comparten suficientes como para que esto las relacione aunque la
  // primera esté mal escrita. `unaccent`+`lower` evitan que tildes o mayúsculas bajen el puntaje
  // por razones que no tienen que ver con el error real. Ver migración V0.2_update_product.
  // Para nombres cortos (hasta SHORT_NAME_MAX_LENGTH) se suma levenshtein() como segunda señal
  // (ver V0.3_update_product): ahí el trigrama solo no alcanza para cazar un "zamba" por "samba".
  private async findSimilarByNameWithin(
    manager: EntityManager,
    companyId: string,
    name: string,
  ): Promise<SimilarProductMatch[]> {
    const rows: SimilarProductMatch[] = await manager.query(
      `SELECT id, name, reference,
              similarity(lower(unaccent(name)), lower(unaccent($1))) AS score
         FROM products
        WHERE "companyId" = $2::uuid
          AND status = $3::record_status
          AND (
            similarity(lower(unaccent(name)), lower(unaccent($1))) >= $4
            OR (
              length($1) <= $5::int AND length(name) <= $5::int
              AND levenshtein(lower(unaccent(name)), lower(unaccent($1)))
                  <= CASE WHEN LEAST(length($1), length(name)) <= $6::int THEN $7::int ELSE $8::int END
            )
          )
        ORDER BY score DESC
        LIMIT ${MAX_SIMILAR_SUGGESTIONS}`,
      [
        name,
        companyId,
        RecordStatus.ACTIVE,
        NAME_SIMILARITY_THRESHOLD,
        SHORT_NAME_MAX_LENGTH,
        SHORT_NAME_MAX_EDITS_TIGHT_LENGTH,
        SHORT_NAME_MAX_EDITS_TIGHT,
        SHORT_NAME_MAX_EDITS,
      ],
    );
    return rows.map((row) => ({ ...row, score: Number(row.score) }));
  }

  // Aviso "¿quisiste decir...?": no bloquea nada distinto de lo que ya existía (la referencia
  // interna sigue siendo el único chequeo duro), solo obliga a confirmar (`confirmDuplicate`)
  // cuando el nombre se parece demasiado a uno que ya existe en esta empresa.
  private async assertNameNotSimilar(manager: EntityManager, companyId: string, name: string): Promise<void> {
    const matches = await this.findSimilarByNameWithin(manager, companyId, name);
    if (matches.length === 0) return;
    const best = matches[0];
    throw new ConflictException({
      message: `Ya existe una referencia parecida: "${best.name}" (${best.reference}). ¿Quisiste decir esta? Si es otra referencia distinta, confírmalo para crearla igual.`,
      code: 'POSSIBLE_DUPLICATE_NAME',
      suggestions: matches,
    });
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
