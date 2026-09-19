import { UseGuards } from '@nestjs/common';
import { Args, Query, Resolver } from '@nestjs/graphql';
import { RequireAnyPermission } from '../../common/decorators/permissions.decorator.js';
import { PermissionCode } from '../../common/enums/permission-code.enum.js';
import { RecordStatus } from '../../common/enums/record-status.enum.js';
import { CsrfGuard } from '../../common/guards/csrf.guard.js';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard.js';
import { PermissionsGuard } from '../../common/guards/permissions.guard.js';
import { PermissionObjectType } from './dto/permission.object-type.js';
import { PermissionModule as PermissionModuleEnum } from './entities/permission-module.enum.js';
import { PermissionService } from './permission.service.js';

@Resolver(() => PermissionObjectType)
@UseGuards(JwtAuthGuard, PermissionsGuard, CsrfGuard)
export class PermissionResolver {
  constructor(private readonly permissionService: PermissionService) {}

  // El catálogo es el mismo para todas las empresas y lo usan tanto Usuarios (ver los
  // permisos de un rol) como Configuración (editarlos).
  @Query(() => [PermissionObjectType])
  @RequireAnyPermission(PermissionCode.USERS_MANAGE, PermissionCode.SETTINGS_MANAGE)
  permissions(
    @Args('module', { type: () => PermissionModuleEnum, nullable: true }) module?: PermissionModuleEnum,
    @Args('status', { type: () => RecordStatus, nullable: true }) status?: RecordStatus,
  ) {
    return this.permissionService.findAll(module, status);
  }
}
