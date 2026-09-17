import { UseGuards } from '@nestjs/common';
import { Args, ID, Mutation, Query, Resolver } from '@nestjs/graphql';
import { Roles } from '../../common/decorators/roles.decorator.js';
import { RecordStatus } from '../../common/enums/record-status.enum.js';
import { CsrfGuard } from '../../common/guards/csrf.guard.js';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard.js';
import { RolesGuard } from '../../common/guards/roles.guard.js';
import { CreateUserLocationAccessInput } from './dto/create-user-location-access.input.js';
import { UserLocationAccessObjectType } from './dto/user-location-access.object-type.js';
import { UserLocationAccessService } from './user-location-access.service.js';

@Resolver(() => UserLocationAccessObjectType)
@UseGuards(JwtAuthGuard, RolesGuard, CsrfGuard)
export class UserLocationAccessResolver {
  constructor(private readonly userLocationAccessService: UserLocationAccessService) {}

  @Query(() => [UserLocationAccessObjectType])
  @Roles('ADMIN')
  userLocationAccess(
    @Args('userId', { type: () => ID, nullable: true }) userId?: string,
    @Args('locationId', { type: () => ID, nullable: true }) locationId?: string,
    @Args('status', { type: () => RecordStatus, nullable: true }) status?: RecordStatus,
  ) {
    return this.userLocationAccessService.findAll(userId, locationId, status);
  }

  @Mutation(() => UserLocationAccessObjectType)
  @Roles('ADMIN')
  createUserLocationAccess(@Args('input') input: CreateUserLocationAccessInput) {
    return this.userLocationAccessService.create(input);
  }

  @Mutation(() => UserLocationAccessObjectType)
  @Roles('ADMIN')
  deactivateUserLocationAccess(@Args('id', { type: () => ID }) id: string) {
    return this.userLocationAccessService.deactivate(id);
  }

  @Mutation(() => UserLocationAccessObjectType)
  @Roles('ADMIN')
  activateUserLocationAccess(@Args('id', { type: () => ID }) id: string) {
    return this.userLocationAccessService.activate(id);
  }
}
