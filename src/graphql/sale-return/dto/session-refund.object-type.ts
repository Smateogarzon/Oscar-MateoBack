import { Field, ObjectType } from '@nestjs/graphql';
import { RefundPaymentObjectType } from './refund-payment.object-type.js';

// Un reembolso de un turno, con el número de la devolución a la que pertenece: lo que el detalle
// del cierre necesita para nombrarlo sin pedir cada devolución por aparte.
@ObjectType('SessionRefund')
export class SessionRefundObjectType extends RefundPaymentObjectType {
  @Field()
  returnNumber: string;
}
