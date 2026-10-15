import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { RecordStatus } from '../../common/enums/record-status.enum.js';
import { Role } from '../role/entities/role.entity.js';
import { RoleScope } from '../role/entities/role-scope.enum.js';
import { UserCompanyRole } from '../user-company-role/entities/user-company-role.entity.js';
import { CompanyStatus } from './entities/company-status.enum.js';
import { Company } from './entities/company.entity.js';

@Injectable()
export class CompanyService {
  constructor(
    @InjectRepository(Company)
    private readonly companyRepository: Repository<Company>,
  ) {}

  // Empresas activas donde el usuario tiene al menos una membresía activa: son las que
  // puede elegir al iniciar sesión.
  //
  // El super admin (rol de plataforma) también elige entre las suspendidas e inactivas: es quien
  // las administra, y loadCompanyAccess ya lo deja operar en ellas. Sin esto podía entrar a una
  // empresa suspendida pero no llegar a ella, porque no le aparecía en el selector.
  findByMember(userId: string): Promise<Company[]> {
    return this.companyRepository
      .createQueryBuilder('company')
      .innerJoin(UserCompanyRole, 'membership', 'membership.companyId = company.id')
      .innerJoin(Role, 'role', 'role.id = membership.roleId')
      .where('membership.userId = :userId', { userId })
      .andWhere('membership.status = :membershipStatus', { membershipStatus: RecordStatus.ACTIVE })
      .andWhere('(company.status = :companyStatus OR role.scope = :platformScope)', {
        companyStatus: CompanyStatus.ACTIVE,
        platformScope: RoleScope.GLOBAL,
      })
      .distinct(true)
      .orderBy('company.name', 'ASC')
      .getMany();
  }
}
