import { UseGuards } from '@nestjs/common';
import { Args, ID, Mutation, Query, Resolver } from '@nestjs/graphql';
import { CurrentCompanyId } from '../../common/decorators/current-company.decorator.js';
import { CurrentUser } from '../../common/decorators/current-user.decorator.js';
import {
  RequireAnyPermission,
  RequirePermissions,
} from '../../common/decorators/permissions.decorator.js';
import { SkipMustChangePassword } from '../../common/decorators/skip-must-change-password.decorator.js';
import { PermissionCode } from '../../common/enums/permission-code.enum.js';
import { RecordStatus } from '../../common/enums/record-status.enum.js';
import { CsrfGuard } from '../../common/guards/csrf.guard.js';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard.js';
import { PermissionsGuard } from '../../common/guards/permissions.guard.js';
import type { JwtPayload } from '../auth/interface/jwt-payload.interface.js';
import { ChangePasswordInput } from './dto/change-password.input.js';
import { CreateUserInput } from './dto/create-user.input.js';
import { UpdateUserInput } from './dto/update-user.input.js';
import { UserObjectType } from './dto/user.object-type.js';
import { UserService } from './user.service.js';

// Todo lo que administra usuarios trabaja sobre los de la empresa activa: ver UserService.
@Resolver(() => UserObjectType)
@UseGuards(JwtAuthGuard, PermissionsGuard, CsrfGuard)
export class UserResolver {
  constructor(private readonly userService: UserService) {}

  // Las pantallas de Usuarios y de Configuración (personal por ubicación) listan usuarios.
  @Query(() => [UserObjectType])
  @RequireAnyPermission(PermissionCode.USERS_MANAGE, PermissionCode.SETTINGS_MANAGE)
  users(
    @CurrentCompanyId() companyId: string,
    @Args('status', { type: () => RecordStatus, nullable: true })
    status?: RecordStatus,
  ) {
    return this.userService.findAll(companyId, status);
  }

  @Query(() => UserObjectType)
  @RequireAnyPermission(PermissionCode.USERS_MANAGE, PermissionCode.SETTINGS_MANAGE)
  user(
    @CurrentCompanyId() companyId: string,
    @Args('id', { type: () => ID }) id: string,
  ) {
    return this.userService.findInCompany(companyId, id);
  }

  @Query(() => UserObjectType)
  @SkipMustChangePassword()
  me(@CurrentUser() currentUser: JwtPayload) {
    return this.userService.findOne(currentUser.sub);
  }

  @Mutation(() => UserObjectType)
  @RequirePermissions(PermissionCode.USERS_MANAGE)
  createUser(
    @CurrentCompanyId() companyId: string,
    @Args('input') input: CreateUserInput,
  ) {
    return this.userService.create(companyId, input);
  }

  @Mutation(() => UserObjectType)
  @RequirePermissions(PermissionCode.USERS_MANAGE)
  updateUser(
    @CurrentCompanyId() companyId: string,
    @Args('id', { type: () => ID }) id: string,
    @Args('input') input: UpdateUserInput,
  ) {
    return this.userService.update(companyId, id, input);
  }

  @Mutation(() => UserObjectType)
  @RequirePermissions(PermissionCode.USERS_MANAGE)
  deactivateUser(
    @CurrentCompanyId() companyId: string,
    @Args('id', { type: () => ID }) id: string,
  ) {
    return this.userService.deactivate(companyId, id);
  }

  // A diferencia de una sede o un medio de pago, un usuario sí se reactiva: desactivar no borra su
  // rol ni sus sedes, y volver a crearlo no es posible (el correo y el documento no se repiten).
  @Mutation(() => UserObjectType)
  @RequirePermissions(PermissionCode.USERS_MANAGE)
  activateUser(
    @CurrentCompanyId() companyId: string,
    @Args('id', { type: () => ID }) id: string,
  ) {
    return this.userService.activate(companyId, id);
  }

  @Mutation(() => UserObjectType)
  @RequirePermissions(PermissionCode.USERS_MANAGE)
  activateUser(
    @CurrentCompanyId() companyId: string,
    @Args('id', { type: () => ID }) id: string,
  ) {
    return this.userService.activate(companyId, id);
  }

  @Mutation(() => UserObjectType)
  @RequirePermissions(PermissionCode.USERS_MANAGE)
  resetUserPassword(
    @CurrentCompanyId() companyId: string,
    @Args('id', { type: () => ID }) id: string,
  ) {
    return this.userService.resetPassword(companyId, id);
  }

  @Mutation(() => UserObjectType)
  @SkipMustChangePassword()
  changePassword(
    @CurrentUser() currentUser: JwtPayload,
    @Args('input') input: ChangePasswordInput,
  ) {
    return this.userService.changePassword(currentUser.sub, input);
  }
}
