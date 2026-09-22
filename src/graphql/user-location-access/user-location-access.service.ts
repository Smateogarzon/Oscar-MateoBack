import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';
import { RecordStatus } from '../../common/enums/record-status.enum.js';
import { mapPostgresWriteError } from '../../common/utils/postgres-error.js';
import { Location } from '../location/entities/location.entity.js';
import { UserCompanyRole } from '../user-company-role/entities/user-company-role.entity.js';
import { CreateUserLocationAccessInput } from './dto/create-user-location-access.input.js';
import { UserLocationAccess } from './entities/user-location-access.entity.js';

// El acceso no lleva empresa propia: es la de su sede. Todo se hace dentro de la empresa
// activa, así que un acceso a una sede de otra empresa se responde como si no existiera.
@Injectable()
export class UserLocationAccessService {
  constructor(
    @InjectRepository(UserLocationAccess)
    private readonly userLocationAccessRepository: Repository<UserLocationAccess>,
    private readonly dataSource: DataSource,
  ) {}

  findAll(
    companyId: string,
    userId?: string,
    locationId?: string,
    status?: RecordStatus,
  ): Promise<UserLocationAccess[]> {
    return this.userLocationAccessRepository.find({
      where: {
        location: { companyId },
        ...(userId && { userId }),
        ...(locationId && { locationId }),
        ...(status && { status }),
      },
    });
  }

  async findOne(companyId: string, id: string): Promise<UserLocationAccess> {
    const access = await this.userLocationAccessRepository.findOneBy({
      id,
      location: { companyId },
    });
    if (!access) throw new NotFoundException(`Acceso ${id} no encontrado`);
    return access;
  }

  // La sede tiene que ser de la empresa y el usuario, miembro activo de ella.
  async create(companyId: string, input: CreateUserLocationAccessInput): Promise<UserLocationAccess> {
    try {
      return await this.dataSource.transaction(async (manager) => {
        const location = await manager
          .getRepository(Location)
          .findOneBy({ id: input.locationId, companyId });
        if (!location) throw new NotFoundException(`Ubicación ${input.locationId} no encontrada`);

        const isMember = await manager.getRepository(UserCompanyRole).existsBy({
          userId: input.userId,
          companyId,
          status: RecordStatus.ACTIVE,
        });
        if (!isMember) throw new NotFoundException(`Usuario ${input.userId} no encontrado`);

        const repo = manager.getRepository(UserLocationAccess);
        return repo.save(repo.create(input));
      });
    } catch (error) {
      throw this.mapWriteError(error);
    }
  }

  async deactivate(companyId: string, id: string): Promise<UserLocationAccess> {
    const access = await this.findOne(companyId, id);
    access.status = RecordStatus.INACTIVE;
    return this.dataSource.transaction((manager) => manager.getRepository(UserLocationAccess).save(access));
  }

  // A diferencia de User/Location, esto sí necesita reactivar: es un checkbox que
  // se prende y apaga, y el índice único (userId, locationId) no distingue estado
  // — recrear el registro tras desactivarlo violaría esa restricción.
  async activate(companyId: string, id: string): Promise<UserLocationAccess> {
    const access = await this.findOne(companyId, id);
    access.status = RecordStatus.ACTIVE;
    return this.dataSource.transaction((manager) => manager.getRepository(UserLocationAccess).save(access));
  }

  private mapWriteError(error: unknown): Error {
    return mapPostgresWriteError(error, {
      foreignKey: 'El usuario o la ubicación indicada no existe',
      unique: 'Este usuario ya tiene acceso a esa ubicación',
    });
  }
}
