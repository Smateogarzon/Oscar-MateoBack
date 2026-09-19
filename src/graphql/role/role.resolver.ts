import { ParseUUIDPipe, UseGuards } from '@nestjs/common';
import { Args, ID, Query, Resolver } from '@nestjs/graphql';
import { CurrentUser } from '../../common/decorators/current-user.decorator.js';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard.js';
import type { JwtPayload } from '../auth/interface/jwt-payload.interface.js';
import { RoleObjectType } from './dto/role.object-type.js';
import { RoleService } from './role.service.js';

@Resolver(() => RoleObjectType)
@UseGuards(JwtAuthGuard)
export class RoleResolver {
  constructor(private readonly roleService: RoleService) {}

  @Query(() => [RoleObjectType])
  roles() {
    return this.roleService.findAll();
  }

  @Query(() => [RoleObjectType])
  myRoles(
    @CurrentUser() currentUser: JwtPayload,
    @Args('companyId', { type: () => ID }, ParseUUIDPipe) companyId: string,
  ) {
    return this.roleService.findByMember(currentUser.sub, companyId);
  }

  @Query(() => RoleObjectType)
  role(@Args('id', { type: () => ID }) id: string) {
    return this.roleService.findOne(id);
  }
}
