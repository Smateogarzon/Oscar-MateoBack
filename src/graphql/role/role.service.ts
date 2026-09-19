import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { COMPANY_VISIBLE_ROLE } from '../../common/access/platform-role.js';
import { RecordStatus } from '../../common/enums/record-status.enum.js';
import { UserCompanyRole } from '../user-company-role/entities/user-company-role.entity.js';
import { Role } from './entities/role.entity.js';

@Injectable()
export class RoleService {
  constructor(
    @InjectRepository(Role)
    private readonly roleRepository: Repository<Role>,
  ) {}

  // Los roles de plataforma (el super admin) no se ofrecen a ninguna empresa: no aparecen ni
  // se pueden consultar por id.
  findAll(): Promise<Role[]> {
    return this.roleRepository.find({ where: COMPANY_VISIBLE_ROLE });
  }

  async findOne(id: string): Promise<Role> {
    const role = await this.roleRepository.findOneBy({ id, ...COMPANY_VISIBLE_ROLE });
    if (!role) throw new NotFoundException(`Rol ${id} no encontrado`);
    return role;
  }

  // Roles que el usuario tiene activos dentro de una empresa concreta. Son los suyos: un
  // super admin ve el suyo.
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
