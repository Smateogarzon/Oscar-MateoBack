import { Decimal } from 'decimal.js';
import { Field, ID, Int, ObjectType } from '@nestjs/graphql';
import { ImmutableObjectType } from '../../../common/dto/immutable.object-type.js';

@ObjectType('InternalOrderItem')
export class InternalOrderItemObjectType extends ImmutableObjectType {
  @Field()
  internalOrderId: string;

  @Field(() => Int)
  versionNumber: number;

  @Field()
  productVariantId: string;

  @Field(() => Decimal)
  quantity: Decimal;

  @Field(() => Decimal, { nullable: true })
  foundQuantity: Decimal | null;

  @Field(() => ID, { nullable: true })
  incidentId: string | null;

  @Field(() => Decimal, { nullable: true })
  unitPrice: Decimal | null;

  @Field(() => Decimal)
  discountAmount: Decimal;

  @Field(() => String, { nullable: true })
  notes: string | null;
}
