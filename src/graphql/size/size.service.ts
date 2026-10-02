import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, ILike, Repository } from 'typeorm';
import { runIdempotent } from '../idempotency/idempotency.js';
import { CreateSizeInput } from './dto/create-size.input.js';
import { Size } from './entities/size.entity.js';

// Catálogo compartido y sin edición (ver size.entity.ts): solo se crea y se lista.
@Injectable()
export class SizeService {
  constructor(
    @InjectRepository(Size)
    private readonly sizeRepository: Repository<Size>,
    private readonly dataSource: DataSource,
  ) {}

  findAll(): Promise<Size[]> {
    return this.sizeRepository.find({ order: { name: 'ASC' } });
  }

  async findOne(id: string): Promise<Size> {
    const size = await this.sizeRepository.findOneBy({ id });
    if (!size) throw new NotFoundException(`Talla ${id} no encontrada`);
    return size;
  }

  async create(
    companyId: string,
    userId: string,
    input: CreateSizeInput,
    idempotencyKey?: string,
  ): Promise<Size> {
    return this.dataSource.transaction((manager) =>
      runIdempotent(
        manager,
        {
          companyId,
          userId,
          operation: 'createSize',
          key: idempotencyKey,
          input,
          resourceType: 'size',
        },
        async () => {
          const repo = manager.getRepository(Size);
          if (await repo.existsBy({ name: ILike(input.name) })) {
            throw new ConflictException(`Ya existe una talla llamada "${input.name}"`);
          }
          return repo.save(repo.create({ name: input.name }));
        },
        (id) => manager.getRepository(Size).findOneByOrFail({ id }),
      ),
    );
  }
}
