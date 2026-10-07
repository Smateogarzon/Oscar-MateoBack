import { Decimal } from 'decimal.js';
import { Field, ID, ObjectType } from '@nestjs/graphql';
import { ImmutableObjectType } from '../../../common/dto/immutable.object-type.js';

@ObjectType('WriteOffItem')
export class WriteOffItemObjectType extends ImmutableObjectType {
  @Field()
  writeOffId: string;

  @Field()
  productVariantId: string;

  @Field(() => Decimal)
  quantity: Decimal;

  @Field(() => ID, { nullable: true })
  incidentId: string | null;

  @Field(() => String, { nullable: true })
  notes: string | null;
}
