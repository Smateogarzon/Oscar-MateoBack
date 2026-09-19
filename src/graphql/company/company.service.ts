import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { RecordStatus } from '../../common/enums/record-status.enum.js';
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
  findByMember(userId: string): Promise<Company[]> {
    return this.companyRepository
      .createQueryBuilder('company')
      .innerJoin(UserCompanyRole, 'membership', 'membership.companyId = company.id')
      .where('membership.userId = :userId', { userId })
      .andWhere('membership.status = :membershipStatus', { membershipStatus: RecordStatus.ACTIVE })
      .andWhere('company.status = :companyStatus', { companyStatus: CompanyStatus.ACTIVE })
      .distinct(true)
      .orderBy('company.name', 'ASC')
      .getMany();
  }
}
