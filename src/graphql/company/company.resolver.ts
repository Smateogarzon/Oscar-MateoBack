import { UseGuards } from '@nestjs/common';
import { Query, Resolver } from '@nestjs/graphql';
import { CurrentUser } from '../../common/decorators/current-user.decorator.js';
import { CsrfGuard } from '../../common/guards/csrf.guard.js';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard.js';
import type { JwtPayload } from '../auth/interface/jwt-payload.interface.js';
import { CompanyService } from './company.service.js';
import { CompanyObjectType } from './dto/company.object-type.js';

// Solo se exponen las empresas del propio usuario. No hay consulta que liste todas ni que
// traiga una por id: para una empresa, otra empresa no existe.
@Resolver(() => CompanyObjectType)
@UseGuards(JwtAuthGuard, CsrfGuard)
export class CompanyResolver {
  constructor(private readonly companyService: CompanyService) {}

  @Query(() => [CompanyObjectType])
  myCompanies(@CurrentUser() currentUser: JwtPayload) {
    return this.companyService.findByMember(currentUser.sub);
  }
}
