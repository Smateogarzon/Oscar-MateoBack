import { UseGuards } from '@nestjs/common';
import { Args, Query, Resolver } from '@nestjs/graphql';
import { Roles } from '../../common/decorators/roles.decorator.js';
import { RecordStatus } from '../../common/enums/record-status.enum.js';
import { CsrfGuard } from '../../common/guards/csrf.guard.js';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard.js';
import { RolesGuard } from '../../common/guards/roles.guard.js';
import { PermissionObjectType } from './dto/permission.object-type.js';
import { PermissionModule as PermissionModuleEnum } from './entities/permission-module.enum.js';
import { PermissionService } from './permission.service.js';

@Resolver(() => PermissionObjectType)
@UseGuards(JwtAuthGuard, RolesGuard, CsrfGuard)
export class PermissionResolver {
  constructor(private readonly permissionService: PermissionService) {}

  @Query(() => [PermissionObjectType])
  @Roles('ADMIN')
  permissions(
    @Args('module', { type: () => PermissionModuleEnum, nullable: true }) module?: PermissionModuleEnum,
    @Args('status', { type: () => RecordStatus, nullable: true }) status?: RecordStatus,
  ) {
    return this.permissionService.findAll(module, status);
  }
}
