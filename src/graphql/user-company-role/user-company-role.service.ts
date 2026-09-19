import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, QueryFailedError, Repository } from 'typeorm';
import { assertActiveCompany } from '../../common/access/assert-active-company.js';
import {
  COMPANY_VISIBLE_ROLE,
  isPlatformRole,
  PLATFORM_ROLE,
} from '../../common/access/platform-role.js';
import { RecordStatus } from '../../common/enums/record-status.enum.js';
import { Role } from '../role/entities/role.entity.js';
import { CreateUserCompanyRoleInput } from './dto/create-user-company-role.input.js';
import { UserCompanyRole } from './entities/user-company-role.entity.js';

const FOREIGN_KEY_VIOLATION = '23503';
const UNIQUE_VIOLATION = '23505';

// Todo se hace dentro de la empresa activa: una empresa nunca ve ni toca las membresías de
// otra, aunque conozca el id. Las membresías con un rol de plataforma (el super admin) no se
// listan, no se desactivan y no se pueden crear desde una empresa.
@Injectable()
export class UserCompanyRoleService {
  constructor(
    @InjectRepository(UserCompanyRole)
    private readonly userCompanyRoleRepository: Repository<UserCompanyRole>,
    private readonly dataSource: DataSource,
  ) {}

  findAll(companyId: string, userId?: string, status?: RecordStatus): Promise<UserCompanyRole[]> {
    return this.userCompanyRoleRepository.find({
      where: {
        companyId,
        role: COMPANY_VISIBLE_ROLE,
        ...(userId && { userId }),
        ...(status && { status }),
      },
    });
  }

  async findOne(companyId: string, id: string): Promise<UserCompanyRole> {
    const userCompanyRole = await this.userCompanyRoleRepository.findOneBy({
      id,
      companyId,
      role: COMPANY_VISIBLE_ROLE,
    });
    if (!userCompanyRole) throw new NotFoundException(`Asignación ${id} no encontrada`);
    return userCompanyRole;
  }

  // Agrega un rol a alguien que ya es de la empresa. Los usuarios nuevos entran con su rol
  // al crearlos (UserService.create); si esto aceptara a cualquiera, se podría sumar a la
  // empresa a un usuario de otra con solo conocer su id.
  async create(companyId: string, input: CreateUserCompanyRoleInput): Promise<UserCompanyRole> {
    assertActiveCompany(companyId, input.companyId);

    try {
      return await this.dataSource.transaction(async (manager) => {
        // Un rol de plataforma se responde igual que uno inexistente: ninguna empresa puede
        // asignarlo, aunque conozca su id.
        const role = await manager.getRepository(Role).findOneBy({ id: input.roleId });
        if (!role || isPlatformRole(role)) {
          throw new NotFoundException(`Rol ${input.roleId} no encontrado`);
        }

        const repo = manager.getRepository(UserCompanyRole);

        const isMember = await repo.existsBy({ userId: input.userId, companyId });
        const isPlatformUser = isMember && (await repo.existsBy({ userId: input.userId, role: PLATFORM_ROLE }));
        if (!isMember || isPlatformUser) {
          throw new NotFoundException(`Usuario ${input.userId} no encontrado`);
        }

        return repo.save(repo.create({ ...input, companyId }));
      });
    } catch (error) {
      throw this.mapWriteError(error);
    }
  }

  async deactivate(companyId: string, id: string): Promise<UserCompanyRole> {
    const userCompanyRole = await this.findOne(companyId, id);
    userCompanyRole.status = RecordStatus.INACTIVE;
    return this.dataSource.transaction((manager) => manager.getRepository(UserCompanyRole).save(userCompanyRole));
  }

  private mapWriteError(error: unknown): Error {
    if (!(error instanceof QueryFailedError)) return error as Error;
    const code = (error.driverError as { code?: string } | undefined)?.code;

    if (code === FOREIGN_KEY_VIOLATION) {
      return new BadRequestException('El usuario, la empresa o el rol indicado no existe');
    }
    if (code === UNIQUE_VIOLATION) {
      return new ConflictException('Este usuario ya tiene ese rol asignado en la empresa');
    }
    return error;
  }
}
