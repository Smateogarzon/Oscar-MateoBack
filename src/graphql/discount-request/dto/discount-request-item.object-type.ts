import { Decimal } from 'decimal.js';
import { Field, ID, ObjectType } from '@nestjs/graphql';

// El descuento de una línea dentro de una solicitud. Una solicitud sobre toda la venta no tiene.
@ObjectType('DiscountRequestItem')
export class DiscountRequestItemObjectType {
  @Field(() => ID)
  id: string;

  @Field()
  discountRequestId: string;

  @Field()
  saleItemId: string;

  @Field(() => Decimal)
  requestedDiscount: Decimal;

  @Field(() => Decimal, { nullable: true })
  approvedDiscount: Decimal | null;
}
