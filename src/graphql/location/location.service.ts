import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, QueryFailedError, Repository } from 'typeorm';
import { RecordStatus } from '../../common/enums/record-status.enum.js';
import { CreateLocationInput } from './dto/create-location.input.js';
import { UpdateLocationInput } from './dto/update-location.input.js';
import { Location } from './entities/location.entity.js';

const FOREIGN_KEY_VIOLATION = '23503';

@Injectable()
export class LocationService {
  constructor(
    @InjectRepository(Location)
    private readonly locationRepository: Repository<Location>,
    private readonly dataSource: DataSource,
  ) {}

  findAll(companyId?: string, status?: RecordStatus): Promise<Location[]> {
    return this.locationRepository.find({
      where: { ...(companyId && { companyId }), ...(status && { status }) },
    });
  }

  async findOne(id: string): Promise<Location> {
    const location = await this.locationRepository.findOneBy({ id });
    if (!location) throw new NotFoundException(`Sede ${id} no encontrada`);
    return location;
  }

  async create(input: CreateLocationInput): Promise<Location> {
    try {
      return await this.dataSource.transaction((manager) => {
        const repo = manager.getRepository(Location);
        return repo.save(repo.create(input));
      });
    } catch (error) {
      throw this.mapForeignKeyError(error);
    }
  }

  async update(id: string, input: UpdateLocationInput): Promise<Location> {
    const location = await this.findOne(id);
    Object.assign(location, input);
    return this.dataSource.transaction((manager) => manager.getRepository(Location).save(location));
  }

  async deactivate(id: string): Promise<Location> {
    const location = await this.findOne(id);
    location.status = RecordStatus.INACTIVE;
    return this.dataSource.transaction((manager) => manager.getRepository(Location).save(location));
  }

  private mapForeignKeyError(error: unknown): Error {
    const isForeignKeyViolation =
      error instanceof QueryFailedError &&
      (error.driverError as { code?: string } | undefined)?.code === FOREIGN_KEY_VIOLATION;

    return isForeignKeyViolation
      ? new BadRequestException('La empresa indicada no existe')
      : (error as Error);
  }
}
