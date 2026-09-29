import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, ILike, Repository } from 'typeorm';
import { runIdempotent } from '../idempotency/idempotency.js';
import { CreateColorInput } from './dto/create-color.input.js';
import { Color } from './entities/color.entity.js';

// Catálogo compartido y sin edición (ver color.entity.ts): solo se crea y se lista. `companyId`/
// `userId` solo identifican la clave de idempotencia; el color en sí no pertenece a esa empresa.
@Injectable()
export class ColorService {
  constructor(
    @InjectRepository(Color)
    private readonly colorRepository: Repository<Color>,
    private readonly dataSource: DataSource,
  ) {}

  findAll(): Promise<Color[]> {
    return this.colorRepository.find({ order: { name: 'ASC' } });
  }

  async findOne(id: string): Promise<Color> {
    const color = await this.colorRepository.findOneBy({ id });
    if (!color) throw new NotFoundException(`Color ${id} no encontrado`);
    return color;
  }

  async create(
    companyId: string,
    userId: string,
    input: CreateColorInput,
    idempotencyKey?: string,
  ): Promise<Color> {
    return this.dataSource.transaction((manager) =>
      runIdempotent(
        manager,
        {
          companyId,
          userId,
          operation: 'createColor',
          key: idempotencyKey,
          input,
          resourceType: 'color',
        },
        async () => {
          const repo = manager.getRepository(Color);
          if (await repo.existsBy({ name: ILike(input.name) })) {
            throw new ConflictException(`Ya existe un color llamado "${input.name}"`);
          }
          return repo.save(repo.create({ name: input.name, hex: input.hex ?? null }));
        },
        (id) => manager.getRepository(Color).findOneByOrFail({ id }),
      ),
    );
  }
}
