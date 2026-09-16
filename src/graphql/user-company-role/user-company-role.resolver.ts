import { UseGuards } from '@nestjs/common';
import { Args, ID, Mutation, Query, Resolver } from '@nestjs/graphql';
import { Roles } from '../../common/decorators/roles.decorator.js';
import { RecordStatus } from '../../common/enums/record-status.enum.js';
import { CsrfGuard } from '../../common/guards/csrf.guard.js';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard.js';
import { RolesGuard } from '../../common/guards/roles.guard.js';
import { CreateUserCompanyRoleInput } from './dto/create-user-company-role.input.js';
import { UserCompanyRoleObjectType } from './dto/user-company-role.object-type.js';
import { UserCompanyRoleService } from './user-company-role.service.js';

@Resolver(() => UserCompanyRoleObjectType)
@UseGuards(JwtAuthGuard, RolesGuard, CsrfGuard)
export class UserCompanyRoleResolver {
  constructor(private readonly userCompanyRoleService: UserCompanyRoleService) {}

  @Query(() => [UserCompanyRoleObjectType])
  @Roles('ADMIN')
  userCompanyRoles(
    @Args('userId', { type: () => ID, nullable: true }) userId?: string,
    @Args('companyId', { type: () => ID, nullable: true }) companyId?: string,
    @Args('status', { type: () => RecordStatus, nullable: true }) status?: RecordStatus,
  ) {
    return this.userCompanyRoleService.findAll(userId, companyId, status);
  }

  @Mutation(() => UserCompanyRoleObjectType)
  @Roles('ADMIN')
  createUserCompanyRole(@Args('input') input: CreateUserCompanyRoleInput) {
    return this.userCompanyRoleService.create(input);
  }

  @Mutation(() => UserCompanyRoleObjectType)
  @Roles('ADMIN')
  deactivateUserCompanyRole(@Args('id', { type: () => ID }) id: string) {
    return this.userCompanyRoleService.deactivate(id);
  }
}
