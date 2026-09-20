import { Decimal } from 'decimal.js';
import { Field, ObjectType } from '@nestjs/graphql';
import { ImmutableObjectType } from '../../../common/dto/immutable.object-type.js';

@ObjectType('SalePayment')
export class SalePaymentObjectType extends ImmutableObjectType {
  @Field()
  saleId: string;

  @Field()
  paymentMethodId: string;

  // Lo que se aplicó a la venta con este medio
  @Field(() => Decimal)
  amount: Decimal;

  @Field(() => String, { nullable: true })
  reference: string | null;

  // Quien registró el pago
  @Field()
  receivedBy: string;
}
