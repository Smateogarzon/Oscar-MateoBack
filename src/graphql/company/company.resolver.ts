import { UseGuards } from '@nestjs/common';
import { Args, ID, Query, Resolver } from '@nestjs/graphql';
import { CsrfGuard } from '../../common/guards/csrf.guard.js';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard.js';
import { CompanyService } from './company.service.js';
import { CompanyObjectType } from './dto/company.object-type.js';

@Resolver(() => CompanyObjectType)
@UseGuards(JwtAuthGuard, CsrfGuard)
export class CompanyResolver {
  constructor(private readonly companyService: CompanyService) {}

  @Query(() => [CompanyObjectType])
  companies() {
    return this.companyService.findAll();
  }

  @Query(() => CompanyObjectType)
  company(@Args('id', { type: () => ID }) id: string) {
    return this.companyService.findOne(id);
  }
}
