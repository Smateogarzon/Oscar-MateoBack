import { UseGuards } from '@nestjs/common';
import { Args, ID, Mutation, Query, Resolver } from '@nestjs/graphql';
import { CurrentCompanyId } from '../../common/decorators/current-company.decorator.js';
import { RequirePermissions } from '../../common/decorators/permissions.decorator.js';
import { PermissionCode } from '../../common/enums/permission-code.enum.js';
import { RecordStatus } from '../../common/enums/record-status.enum.js';
import { CsrfGuard } from '../../common/guards/csrf.guard.js';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard.js';
import { PermissionsGuard } from '../../common/guards/permissions.guard.js';
import { CreateUserLocationAccessInput } from './dto/create-user-location-access.input.js';
import { UserLocationAccessObjectType } from './dto/user-location-access.object-type.js';
import { UserLocationAccessService } from './user-location-access.service.js';

@Resolver(() => UserLocationAccessObjectType)
@UseGuards(JwtAuthGuard, PermissionsGuard, CsrfGuard)
export class UserLocationAccessResolver {
  constructor(private readonly userLocationAccessService: UserLocationAccessService) {}

  @Query(() => [UserLocationAccessObjectType])
  @RequirePermissions(PermissionCode.SETTINGS_MANAGE)
  userLocationAccess(
    @CurrentCompanyId() companyId: string,
    @Args('userId', { type: () => ID, nullable: true }) userId?: string,
    @Args('locationId', { type: () => ID, nullable: true }) locationId?: string,
    @Args('status', { type: () => RecordStatus, nullable: true }) status?: RecordStatus,
  ) {
    return this.userLocationAccessService.findAll(companyId, userId, locationId, status);
  }

  @Mutation(() => UserLocationAccessObjectType)
  @RequirePermissions(PermissionCode.SETTINGS_MANAGE)
  createUserLocationAccess(
    @CurrentCompanyId() companyId: string,
    @Args('input') input: CreateUserLocationAccessInput,
  ) {
    return this.userLocationAccessService.create(companyId, input);
  }

  @Mutation(() => UserLocationAccessObjectType)
  @RequirePermissions(PermissionCode.SETTINGS_MANAGE)
  deactivateUserLocationAccess(
    @CurrentCompanyId() companyId: string,
    @Args('id', { type: () => ID }) id: string,
  ) {
    return this.userLocationAccessService.deactivate(companyId, id);
  }

  @Mutation(() => UserLocationAccessObjectType)
  @RequirePermissions(PermissionCode.SETTINGS_MANAGE)
  activateUserLocationAccess(
    @CurrentCompanyId() companyId: string,
    @Args('id', { type: () => ID }) id: string,
  ) {
    return this.userLocationAccessService.activate(companyId, id);
  }
}
