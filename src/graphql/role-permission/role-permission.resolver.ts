import { UseGuards } from '@nestjs/common';
import { Args, ID, Mutation, Query, Resolver } from '@nestjs/graphql';
import { CurrentCompanyId } from '../../common/decorators/current-company.decorator.js';
import {
  RequireAnyPermission,
  RequirePermissions,
} from '../../common/decorators/permissions.decorator.js';
import { PermissionCode } from '../../common/enums/permission-code.enum.js';
import { CsrfGuard } from '../../common/guards/csrf.guard.js';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard.js';
import { PermissionsGuard } from '../../common/guards/permissions.guard.js';
import { CreateRolePermissionInput } from './dto/create-role-permission.input.js';
import { RolePermissionObjectType } from './dto/role-permission.object-type.js';
import { RolePermissionService } from './role-permission.service.js';

@Resolver(() => RolePermissionObjectType)
@UseGuards(JwtAuthGuard, PermissionsGuard, CsrfGuard)
export class RolePermissionResolver {
  constructor(private readonly rolePermissionService: RolePermissionService) {}

  // Leerlas sirve tanto a Configuración (editarlas) como a Usuarios (ver los permisos de un
  // rol); cambiarlas solo lo hace quien administra la configuración.
  @Query(() => [RolePermissionObjectType])
  @RequireAnyPermission(PermissionCode.USERS_MANAGE, PermissionCode.SETTINGS_MANAGE)
  rolePermissions(
    @CurrentCompanyId() companyId: string,
    @Args('roleId', { type: () => ID, nullable: true }) roleId?: string,
  ) {
    return this.rolePermissionService.findAll(companyId, roleId);
  }

  @Mutation(() => RolePermissionObjectType)
  @RequirePermissions(PermissionCode.SETTINGS_MANAGE)
  createRolePermission(
    @CurrentCompanyId() companyId: string,
    @Args('input') input: CreateRolePermissionInput,
  ) {
    return this.rolePermissionService.create(companyId, input);
  }

  @Mutation(() => Boolean)
  @RequirePermissions(PermissionCode.SETTINGS_MANAGE)
  deleteRolePermission(
    @CurrentCompanyId() companyId: string,
    @Args('id', { type: () => ID }) id: string,
  ) {
    return this.rolePermissionService.remove(companyId, id);
  }
}
