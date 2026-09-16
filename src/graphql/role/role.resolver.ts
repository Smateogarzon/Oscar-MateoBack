import { UseGuards } from '@nestjs/common';
import { Args, ID, Query, Resolver } from '@nestjs/graphql';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard.js';
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

  @Query(() => RoleObjectType)
  role(@Args('id', { type: () => ID }) id: string) {
    return this.roleService.findOne(id);
  }
}
