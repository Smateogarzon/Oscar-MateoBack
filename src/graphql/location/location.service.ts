import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';
import { assertActiveCompany } from '../../common/access/assert-active-company.js';
import { RecordStatus } from '../../common/enums/record-status.enum.js';
import {
  DEFAULT_CASH_REGISTER_CODE,
  defaultCashRegisterName,
} from '../cash-register/default-cash-register.js';
import { CashRegister } from '../cash-register/entities/cash-register.entity.js';
import { CreateLocationInput } from './dto/create-location.input.js';
import { UpdateLocationInput } from './dto/update-location.input.js';
import { LocationType } from './entities/location-type.enum.js';
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

  // Una tienda nace con su caja, con el nombre de la tienda (ver default-cash-register.ts); las
  // bodegas no tienen. Las dos se guardan en la misma transacción: no queda una tienda sin caja.
  async create(companyId: string, input: CreateLocationInput): Promise<Location> {
    assertActiveCompany(companyId, input.companyId);

    return this.dataSource.transaction(async (manager) => {
      const repo = manager.getRepository(Location);
      const location = await repo.save(repo.create({ ...input, companyId }));

      if (location.type === LocationType.STORE) {
        const registerRepo = manager.getRepository(CashRegister);
        await registerRepo.save(
          registerRepo.create({
            storeId: location.id,
            name: defaultCashRegisterName(location.name),
            code: DEFAULT_CASH_REGISTER_CODE,
          }),
        );
      }

      return location;
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
