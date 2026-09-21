import { Decimal } from 'decimal.js';
import { Field, ObjectType } from '@nestjs/graphql';
import { ImmutableObjectType } from '../../../common/dto/immutable.object-type.js';

@ObjectType('RefundPayment')
export class RefundPaymentObjectType extends ImmutableObjectType {
  @Field()
  saleReturnId: string;

  @Field()
  paymentMethodId: string;

  @Field(() => Decimal)
  amount: Decimal;

  @Field(() => String, { nullable: true })
  reference: string | null;

  // El turno del que salió el reembolso (vacío si no fue en efectivo y no se indicó)
  @Field(() => String, { nullable: true })
  cashSessionId: string | null;

  // Quien entregó el reembolso
  @Field()
  paidBy: string;
}
