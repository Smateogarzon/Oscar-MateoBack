import { Args, ID, Mutation, Query, Resolver } from '@nestjs/graphql';
import { RecordStatus } from '../../common/enums/record-status.enum.js';
import { CreateUserInput } from './dto/create-user.input.js';
import { UpdateUserInput } from './dto/update-user.input.js';
import { UserObjectType } from './dto/user.object-type.js';
import { UserService } from './user.service.js';

@Resolver(() => UserObjectType)
export class UserResolver {
  constructor(private readonly userService: UserService) {}

  @Query(() => [UserObjectType])
  users(
    @Args('status', { type: () => RecordStatus, nullable: true }) status?: RecordStatus,
  ) {
    return this.userService.findAll(status);
  }

  @Query(() => UserObjectType)
  user(@Args('id', { type: () => ID }) id: string) {
    return this.userService.findOne(id);
  }

  @Mutation(() => UserObjectType)
  createUser(@Args('input') input: CreateUserInput) {
    return this.userService.create(input);
  }

  @Mutation(() => UserObjectType)
  updateUser(
    @Args('id', { type: () => ID }) id: string,
    @Args('input') input: UpdateUserInput,
  ) {
    return this.userService.update(id, input);
  }

  @Mutation(() => UserObjectType)
  deactivateUser(@Args('id', { type: () => ID }) id: string) {
    return this.userService.deactivate(id);
  }
}
