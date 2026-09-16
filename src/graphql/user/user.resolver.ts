import { UseGuards } from '@nestjs/common';
import { Args, ID, Mutation, Query, Resolver } from '@nestjs/graphql';
import { CurrentUser } from '../../common/decorators/current-user.decorator.js';
import { Roles } from '../../common/decorators/roles.decorator.js';
import { SkipMustChangePassword } from '../../common/decorators/skip-must-change-password.decorator.js';
import { RecordStatus } from '../../common/enums/record-status.enum.js';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard.js';
import { RolesGuard } from '../../common/guards/roles.guard.js';
import type { JwtPayload } from '../auth/interface/jwt-payload.interface.js';
import { ChangePasswordInput } from './dto/change-password.input.js';
import { CreateUserInput } from './dto/create-user.input.js';
import { UpdateUserInput } from './dto/update-user.input.js';
import { UserObjectType } from './dto/user.object-type.js';
import { UserService } from './user.service.js';

@Resolver(() => UserObjectType)
@UseGuards(JwtAuthGuard, RolesGuard)
export class UserResolver {
  constructor(private readonly userService: UserService) {}

  @Query(() => [UserObjectType])
  @Roles('ADMIN')
  users(
    @Args('status', { type: () => RecordStatus, nullable: true })
    status?: RecordStatus,
  ) {
    return this.userService.findAll(status);
  }

  @Query(() => UserObjectType)
  @Roles('ADMIN')
  user(@Args('id', { type: () => ID }) id: string) {
    return this.userService.findOne(id);
  }

  @Mutation(() => UserObjectType)
  @Roles('ADMIN')
  createUser(@Args('input') input: CreateUserInput) {
    return this.userService.create(input);
  }

  @Mutation(() => UserObjectType)
  @Roles('ADMIN')
  updateUser(
    @Args('id', { type: () => ID }) id: string,
    @Args('input') input: UpdateUserInput,
  ) {
    return this.userService.update(id, input);
  }

  @Mutation(() => UserObjectType)
  @Roles('ADMIN')
  deactivateUser(@Args('id', { type: () => ID }) id: string) {
    return this.userService.deactivate(id);
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
