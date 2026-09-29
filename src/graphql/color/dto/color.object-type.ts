import { Field, ObjectType } from '@nestjs/graphql';
import { ImmutableObjectType } from '../../../common/dto/immutable.object-type.js';

@ObjectType('Color')
export class ColorObjectType extends ImmutableObjectType {
  @Field()
  name: string;

  @Field(() => String, { nullable: true })
  hex: string | null;
}
