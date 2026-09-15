import { Field, ID, ObjectType } from '@nestjs/graphql';

@ObjectType({ isAbstract: true })
export abstract class ImmutableObjectType {
  @Field(() => ID)
  id: string;

  @Field(() => Date)
  createdAt: Date;
}
