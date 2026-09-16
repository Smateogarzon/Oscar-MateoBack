import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, QueryFailedError, Repository } from 'typeorm';
import { RecordStatus } from '../../common/enums/record-status.enum.js';
import { CreateUserCompanyRoleInput } from './dto/create-user-company-role.input.js';
import { UserCompanyRole } from './entities/user-company-role.entity.js';

const FOREIGN_KEY_VIOLATION = '23503';
const UNIQUE_VIOLATION = '23505';

@Injectable()
export class UserCompanyRoleService {
  constructor(
    @InjectRepository(UserCompanyRole)
    private readonly userCompanyRoleRepository: Repository<UserCompanyRole>,
    private readonly dataSource: DataSource,
  ) {}

  findAll(userId?: string, companyId?: string, status?: RecordStatus): Promise<UserCompanyRole[]> {
    return this.userCompanyRoleRepository.find({
      where: { ...(userId && { userId }), ...(companyId && { companyId }), ...(status && { status }) },
    });
  }

  async findOne(id: string): Promise<UserCompanyRole> {
    const userCompanyRole = await this.userCompanyRoleRepository.findOneBy({ id });
    if (!userCompanyRole) throw new NotFoundException(`Asignación ${id} no encontrada`);
    return userCompanyRole;
  }

  async create(input: CreateUserCompanyRoleInput): Promise<UserCompanyRole> {
    try {
      return await this.dataSource.transaction((manager) => {
        const repo = manager.getRepository(UserCompanyRole);
        return repo.save(repo.create(input));
      });
    } catch (error) {
      throw this.mapWriteError(error);
    }
  }

  async deactivate(id: string): Promise<UserCompanyRole> {
    const userCompanyRole = await this.findOne(id);
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
