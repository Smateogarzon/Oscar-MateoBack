import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, EntityManager, type FindOptionsWhere, IsNull, Not, Repository } from 'typeorm';
import { RecordStatus } from '../../common/enums/record-status.enum.js';
import { definedFields } from '../../common/utils/defined-fields.js';
import { uniqueSlug } from '../../common/utils/slugify.js';
import { runIdempotent } from '../idempotency/idempotency.js';
import { CreateCategoryInput } from './dto/create-category.input.js';
import { UpdateCategoryInput } from './dto/update-category.input.js';
import { Category } from './entities/category.entity.js';

const SLUG_MAX_LENGTH = 140;

// Todo se hace dentro de la empresa activa: una categoría de otra empresa se responde igual que
// una que no existe (a diferencia de las marcas, que son compartidas: ver brand.service.ts).
@Injectable()
export class CategoryService {
  constructor(
    @InjectRepository(Category)
    private readonly categoryRepository: Repository<Category>,
    private readonly dataSource: DataSource,
  ) {}

  // `parentId` distingue "no filtrar por padre" (ausente) de "solo las raíz" (null): quien llama
  // decide cuál quiere.
  findAll(companyId: string, status?: RecordStatus, parentId?: string | null): Promise<Category[]> {
    // Anotado a mano: `Category` es la única entidad que se referencia a sí misma (`parent`), lo
    // que vuelve `FindOptionsWhere<Category>` un tipo recursivo. Sin este tipo explícito, TS no
    // resuelve bien la unión de un objeto armado con spreads condicionales contra ese tipo.
    // `parentId: null` no es un valor válido de columna para TypeORM: una raíz se busca con
    // `IsNull()`, no con el `null` literal.
    const where: FindOptionsWhere<Category> = {
      companyId,
      ...(status && { status }),
      ...(parentId !== undefined && { parentId: parentId === null ? IsNull() : parentId }),
    };
    return this.categoryRepository.find({ where, order: { name: 'ASC' } });
  }

  async findOne(companyId: string, id: string): Promise<Category> {
    const category = await this.categoryRepository.findOneBy({ id, companyId });
    if (!category) throw new NotFoundException(`Categoría ${id} no encontrada`);
    return category;
  }

  async create(
    companyId: string,
    userId: string,
    input: CreateCategoryInput,
    idempotencyKey?: string,
  ): Promise<Category> {
    return this.dataSource.transaction((manager) =>
      runIdempotent(
        manager,
        {
          companyId,
          userId,
          operation: 'createCategory',
          key: idempotencyKey,
          input,
          resourceType: 'category',
        },
        async () => {
          if (input.parentId) await this.assertParentExists(manager, companyId, input.parentId);

          const repo = manager.getRepository(Category);
          const slug = await this.uniqueSlug(manager, companyId, input.name);
          return repo.save(
            repo.create({
              companyId,
              name: input.name,
              slug,
              parentId: input.parentId ?? null,
              description: input.description ?? null,
            }),
          );
        },
        (id) => manager.getRepository(Category).findOneByOrFail({ id }),
      ),
    );
  }

  async update(companyId: string, id: string, input: UpdateCategoryInput): Promise<Category> {
    await this.findOne(companyId, id);

    return this.dataSource.transaction(async (manager) => {
      const category = await this.lock(manager, companyId, id);
      const changes = definedFields(input);

      if (changes.parentId !== undefined && changes.parentId !== category.parentId) {
        await this.assertNewParent(manager, companyId, category, changes.parentId);
        category.parentId = changes.parentId;
      }
      if (changes.name !== undefined && changes.name !== category.name) {
        category.slug = await this.uniqueSlug(manager, companyId, changes.name, category.id);
        category.name = changes.name;
      }
      if (changes.description !== undefined) category.description = changes.description;

      return manager.getRepository(Category).save(category);
    });
  }

  // Una categoría con subcategorías activas no se desactiva: quedarían colgando bajo una rama
  // inactiva sin que nadie lo note. Se desactivan primero ellas (de abajo hacia arriba), o esta se
  // deja como está.
  async deactivate(companyId: string, id: string): Promise<Category> {
    await this.findOne(companyId, id);

    return this.dataSource.transaction(async (manager) => {
      const category = await this.lock(manager, companyId, id);
      const hasActiveChildren = await manager.getRepository(Category).existsBy({
        companyId,
        parentId: category.id,
        status: RecordStatus.ACTIVE,
      });
      if (hasActiveChildren) {
        throw new ConflictException(
          `La categoría ${category.name} tiene subcategorías activas: desactívalas primero`,
        );
      }
      category.status = RecordStatus.INACTIVE;
      return manager.getRepository(Category).save(category);
    });
  }

  // Reactivarla no exige nada de sus subcategorías ni de su padre: una categoría inactiva bajo un
  // padre inactivo es una situación normal (igual que una sede reactivada conserva las cajas que
  // tenía, sin condiciones extra).
  async activate(companyId: string, id: string): Promise<Category> {
    await this.findOne(companyId, id);
    return this.dataSource.transaction(async (manager) => {
      const category = await this.lock(manager, companyId, id);
      category.status = RecordStatus.ACTIVE;
      return manager.getRepository(Category).save(category);
    });
  }

  private async lock(manager: EntityManager, companyId: string, id: string): Promise<Category> {
    const category = await manager
      .getRepository(Category)
      .findOne({ where: { id, companyId }, lock: { mode: 'pessimistic_write' } });
    if (!category) throw new NotFoundException(`Categoría ${id} no encontrada`);
    return category;
  }

  private async assertParentExists(manager: EntityManager, companyId: string, parentId: string): Promise<void> {
    const exists = await manager.getRepository(Category).existsBy({ id: parentId, companyId });
    if (!exists) throw new NotFoundException(`Categoría ${parentId} no encontrada`);
  }

  // parentId ya viene distinto del actual (lo comprueba quien llama). null siempre se acepta (vuelve
  // raíz); con un id, tiene que existir en la empresa, no ser ella misma y no ser una de sus propias
  // subcategorías (si no, quedaría bloqueada bajo su propia rama para siempre).
  private async assertNewParent(
    manager: EntityManager,
    companyId: string,
    category: Category,
    parentId: string | null,
  ): Promise<void> {
    if (parentId === null) return;
    if (parentId === category.id) {
      throw new BadRequestException('Una categoría no puede ser su propio padre');
    }
    await this.assertParentExists(manager, companyId, parentId);
    if (await this.isDescendant(manager, category.id, parentId)) {
      throw new BadRequestException(
        'No puedes mover una categoría dentro de una de sus propias subcategorías',
      );
    }
  }

  // ¿"candidateId" está en el árbol de abajo de "categoryId"? (hijo, nieto, ...).
  private async isDescendant(
    manager: EntityManager,
    categoryId: string,
    candidateId: string,
  ): Promise<boolean> {
    const rows: unknown[] = await manager.query(
      `WITH RECURSIVE descendants AS (
         SELECT "id" FROM "categories" WHERE "parentId" = $1
         UNION ALL
         SELECT c."id" FROM "categories" c JOIN descendants d ON c."parentId" = d."id"
       )
       SELECT 1 FROM descendants WHERE "id" = $2`,
      [categoryId, candidateId],
    );
    return rows.length > 0;
  }

  private async uniqueSlug(
    manager: EntityManager,
    companyId: string,
    name: string,
    excludeId?: string,
  ): Promise<string> {
    // Las categorías son de cada empresa: el slug no se repite dentro de la empresa.
    const repo = manager.getRepository(Category);
    return uniqueSlug(name, SLUG_MAX_LENGTH, (slug) =>
      repo.existsBy({ companyId, slug, ...(excludeId && { id: Not(excludeId) }) }),
    );
  }
}
