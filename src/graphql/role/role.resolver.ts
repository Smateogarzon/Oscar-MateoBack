import { Args, ID, Query, Resolver } from '@nestjs/graphql';
import { RoleObjectType } from './dto/role.object-type.js';
import { RoleService } from './role.service.js';

@Resolver(() => RoleObjectType)
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
