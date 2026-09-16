import { Field, ObjectType } from '@nestjs/graphql';
import { UserObjectType } from '../../user/dto/user.object-type.js';

@ObjectType('AuthPayload')
export class AuthPayload {
  @Field(() => UserObjectType)
  user: UserObjectType;
}
