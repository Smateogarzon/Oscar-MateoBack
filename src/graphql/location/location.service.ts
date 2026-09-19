import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';
import { assertActiveCompany } from '../../common/access/assert-active-company.js';
import { RecordStatus } from '../../common/enums/record-status.enum.js';
import { CreateLocationInput } from './dto/create-location.input.js';
import { UpdateLocationInput } from './dto/update-location.input.js';
import { Location } from './entities/location.entity.js';

// Todo se hace dentro de la empresa activa: una sede de otra empresa se responde igual que
// una que no existe.
@Injectable()
export class LocationService {
  constructor(
    @InjectRepository(Location)
    private readonly locationRepository: Repository<Location>,
    private readonly dataSource: DataSource,
  ) {}

  findAll(companyId: string, status?: RecordStatus): Promise<Location[]> {
    return this.locationRepository.find({
      where: { companyId, ...(status && { status }) },
    });
  }

  async findOne(companyId: string, id: string): Promise<Location> {
    const location = await this.locationRepository.findOneBy({ id, companyId });
    if (!location) throw new NotFoundException(`Sede ${id} no encontrada`);
    return location;
  }

  async create(companyId: string, input: CreateLocationInput): Promise<Location> {
    assertActiveCompany(companyId, input.companyId);

    return this.dataSource.transaction((manager) => {
      const repo = manager.getRepository(Location);
      return repo.save(repo.create({ ...input, companyId }));
    });
  }

  async update(companyId: string, id: string, input: UpdateLocationInput): Promise<Location> {
    const location = await this.findOne(companyId, id);
    Object.assign(location, input);
    return this.dataSource.transaction((manager) => manager.getRepository(Location).save(location));
  }

  async deactivate(companyId: string, id: string): Promise<Location> {
    const location = await this.findOne(companyId, id);
    location.status = RecordStatus.INACTIVE;
    return this.dataSource.transaction((manager) => manager.getRepository(Location).save(location));
  }
}
