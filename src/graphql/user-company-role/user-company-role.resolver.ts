import { UseGuards } from '@nestjs/common';
import { Args, ID, Mutation, Query, Resolver } from '@nestjs/graphql';
import { assertActiveCompany } from '../../common/access/assert-active-company.js';
import { CurrentCompanyId } from '../../common/decorators/current-company.decorator.js';
import { RequirePermissions } from '../../common/decorators/permissions.decorator.js';
import { PermissionCode } from '../../common/enums/permission-code.enum.js';
import { RecordStatus } from '../../common/enums/record-status.enum.js';
import { CsrfGuard } from '../../common/guards/csrf.guard.js';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard.js';
import { PermissionsGuard } from '../../common/guards/permissions.guard.js';
import { CreateUserCompanyRoleInput } from './dto/create-user-company-role.input.js';
import { UserCompanyRoleObjectType } from './dto/user-company-role.object-type.js';
import { UserCompanyRoleService } from './user-company-role.service.js';

@Resolver(() => UserCompanyRoleObjectType)
@UseGuards(JwtAuthGuard, PermissionsGuard, CsrfGuard)
export class UserCompanyRoleResolver {
  constructor(private readonly userCompanyRoleService: UserCompanyRoleService) {}

  // `companyId` se acepta por compatibilidad, pero solo puede ser la empresa activa: sin él
  // se lista igual la activa.
  @Query(() => [UserCompanyRoleObjectType])
  @RequirePermissions(PermissionCode.USERS_MANAGE)
  userCompanyRoles(
    @CurrentCompanyId() activeCompanyId: string,
    @Args('userId', { type: () => ID, nullable: true }) userId?: string,
    @Args('companyId', { type: () => ID, nullable: true }) companyId?: string,
    @Args('status', { type: () => RecordStatus, nullable: true }) status?: RecordStatus,
  ) {
    assertActiveCompany(activeCompanyId, companyId);
    return this.userCompanyRoleService.findAll(activeCompanyId, userId, status);
  }

  @Mutation(() => UserCompanyRoleObjectType)
  @RequirePermissions(PermissionCode.USERS_MANAGE)
  createUserCompanyRole(
    @CurrentCompanyId() companyId: string,
    @Args('input') input: CreateUserCompanyRoleInput,
  ) {
    return this.userCompanyRoleService.create(companyId, input);
  }

  @Mutation(() => UserCompanyRoleObjectType)
  @RequirePermissions(PermissionCode.USERS_MANAGE)
  deactivateUserCompanyRole(
    @CurrentCompanyId() companyId: string,
    @Args('id', { type: () => ID }) id: string,
  ) {
    return this.userCompanyRoleService.deactivate(companyId, id);
  }
}
