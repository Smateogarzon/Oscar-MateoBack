import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, EntityManager, ILike, Not, Repository } from 'typeorm';
import { RecordStatus } from '../../common/enums/record-status.enum.js';
import { definedFields } from '../../common/utils/defined-fields.js';
import { slugify } from '../../common/utils/slugify.js';
import { runIdempotent } from '../idempotency/idempotency.js';
import { CreateBrandInput } from './dto/create-brand.input.js';
import { UpdateBrandInput } from './dto/update-brand.input.js';
import { Brand } from './entities/brand.entity.js';

const SLUG_MAX_LENGTH = 140;

// Catálogo compartido entre empresas: no hay `companyId` en ninguna consulta a propósito (ver
// brand.entity.ts). Solo lo escribe el super administrador (permiso inventory.manage_catalog); lo
// lee cualquier miembro de cualquier empresa, porque después un producto de cualquier empresa va a
// necesitar elegir una marca de esta misma lista.
@Injectable()
export class BrandService {
  constructor(
    @InjectRepository(Brand)
    private readonly brandRepository: Repository<Brand>,
    private readonly dataSource: DataSource,
  ) {}

  findAll(status?: RecordStatus): Promise<Brand[]> {
    return this.brandRepository.find({
      where: { ...(status && { status }) },
      order: { name: 'ASC' },
    });
  }

  async findOne(id: string): Promise<Brand> {
    const brand = await this.brandRepository.findOneBy({ id });
    if (!brand) throw new NotFoundException(`Marca ${id} no encontrada`);
    return brand;
  }

  // `companyId`/`userId` solo identifican la clave de idempotencia (con qué sesión se pidió esto):
  // la marca en sí no pertenece a esa empresa.
  async create(
    companyId: string,
    userId: string,
    input: CreateBrandInput,
    idempotencyKey?: string,
  ): Promise<Brand> {
    return this.dataSource.transaction((manager) =>
      runIdempotent(
        manager,
        {
          companyId,
          userId,
          operation: 'createBrand',
          key: idempotencyKey,
          input,
          resourceType: 'brand',
        },
        async () => {
          const repo = manager.getRepository(Brand);
          await this.assertNameFree(manager, input.name);
          const slug = await this.uniqueSlug(manager, input.name);
          return repo.save(repo.create({ name: input.name, slug, logoUrl: input.logoUrl ?? null }));
        },
        (id) => manager.getRepository(Brand).findOneByOrFail({ id }),
      ),
    );
  }

  async update(id: string, input: UpdateBrandInput): Promise<Brand> {
    await this.findOne(id);

    return this.dataSource.transaction(async (manager) => {
      const brand = await this.lock(manager, id);
      const changes = definedFields(input);

      if (changes.name !== undefined && changes.name !== brand.name) {
        await this.assertNameFree(manager, changes.name, brand.id);
        brand.slug = await this.uniqueSlug(manager, changes.name, brand.id);
        brand.name = changes.name;
      }
      if (changes.logoUrl !== undefined) brand.logoUrl = changes.logoUrl;

      return manager.getRepository(Brand).save(brand);
    });
  }

  async deactivate(id: string): Promise<Brand> {
    await this.findOne(id);
    return this.dataSource.transaction(async (manager) => {
      const brand = await this.lock(manager, id);
      brand.status = RecordStatus.INACTIVE;
      return manager.getRepository(Brand).save(brand);
    });
  }

  async activate(id: string): Promise<Brand> {
    await this.findOne(id);
    return this.dataSource.transaction(async (manager) => {
      const brand = await this.lock(manager, id);
      brand.status = RecordStatus.ACTIVE;
      return manager.getRepository(Brand).save(brand);
    });
  }

  private async lock(manager: EntityManager, id: string): Promise<Brand> {
    const brand = await manager
      .getRepository(Brand)
      .findOne({ where: { id }, lock: { mode: 'pessimistic_write' } });
    if (!brand) throw new NotFoundException(`Marca ${id} no encontrada`);
    return brand;
  }

  // Antes de guardar (no solo al final): "Nike" y "nike" son la misma marca para quien compra.
  private async assertNameFree(manager: EntityManager, name: string, excludeId?: string): Promise<void> {
    const clash = await manager.getRepository(Brand).existsBy({
      name: ILike(name),
      ...(excludeId && { id: Not(excludeId) }),
    });
    if (clash) throw new ConflictException(`Ya existe una marca llamada "${name}"`);
  }

  private async uniqueSlug(manager: EntityManager, name: string, excludeId?: string): Promise<string> {
    const repo = manager.getRepository(Brand);
    const base = slugify(name, SLUG_MAX_LENGTH);
    let candidate = base;
    for (let suffix = 2; await repo.existsBy({ slug: candidate, ...(excludeId && { id: Not(excludeId) }) }); suffix++) {
      candidate = `${base}-${suffix}`.slice(0, SLUG_MAX_LENGTH);
    }
    return candidate;
  }
}
