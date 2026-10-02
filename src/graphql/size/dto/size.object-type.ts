import { Field, ObjectType } from '@nestjs/graphql';
import { ImmutableObjectType } from '../../../common/dto/immutable.object-type.js';

@ObjectType('Size')
export class SizeObjectType extends ImmutableObjectType {
  @Field()
  name: string;
}
