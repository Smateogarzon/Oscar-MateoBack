import { UseGuards } from '@nestjs/common';
import { Args, ID, Mutation, Query, Resolver } from '@nestjs/graphql';
import { Roles } from '../../common/decorators/roles.decorator.js';
import { CsrfGuard } from '../../common/guards/csrf.guard.js';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard.js';
import { RolesGuard } from '../../common/guards/roles.guard.js';
import { CreateRolePermissionInput } from './dto/create-role-permission.input.js';
import { RolePermissionObjectType } from './dto/role-permission.object-type.js';
import { RolePermissionService } from './role-permission.service.js';

@Resolver(() => RolePermissionObjectType)
@UseGuards(JwtAuthGuard, RolesGuard, CsrfGuard)
export class RolePermissionResolver {
  constructor(private readonly rolePermissionService: RolePermissionService) {}

  @Query(() => [RolePermissionObjectType])
  @Roles('ADMIN')
  rolePermissions(@Args('roleId', { type: () => ID, nullable: true }) roleId?: string) {
    return this.rolePermissionService.findAll(roleId);
  }

  @Mutation(() => RolePermissionObjectType)
  @Roles('ADMIN')
  createRolePermission(@Args('input') input: CreateRolePermissionInput) {
    return this.rolePermissionService.create(input);
  }

  @Mutation(() => Boolean)
  @Roles('ADMIN')
  deleteRolePermission(@Args('id', { type: () => ID }) id: string) {
    return this.rolePermissionService.remove(id);
  }
}
