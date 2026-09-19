import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { RecordStatus } from '../../common/enums/record-status.enum.js';
import { UserCompanyRole } from '../user-company-role/entities/user-company-role.entity.js';
import { Role } from './entities/role.entity.js';

@Injectable()
export class RoleService {
  constructor(
    @InjectRepository(Role)
    private readonly roleRepository: Repository<Role>,
  ) {}

  findAll(): Promise<Role[]> {
    return this.roleRepository.find();
  }

  async findOne(id: string): Promise<Role> {
    const role = await this.roleRepository.findOneBy({ id });
    if (!role) throw new NotFoundException(`Rol ${id} no encontrado`);
    return role;
  }

  // Roles que el usuario tiene activos dentro de una empresa concreta.
  findByMember(userId: string, companyId: string): Promise<Role[]> {
    return this.roleRepository
      .createQueryBuilder('role')
      .innerJoin(UserCompanyRole, 'membership', 'membership.roleId = role.id')
      .where('membership.userId = :userId', { userId })
      .andWhere('membership.companyId = :companyId', { companyId })
      .andWhere('membership.status = :status', { status: RecordStatus.ACTIVE })
      .orderBy('role.name', 'ASC')
      .getMany();
  }
}
