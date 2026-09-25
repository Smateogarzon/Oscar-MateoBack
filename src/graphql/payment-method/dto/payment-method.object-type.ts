import { Field, ObjectType, registerEnumType } from '@nestjs/graphql';
import { BaseObjectType } from '../../../common/dto/base.object-type.js';
import '../../../common/dto/record-status.enum-type.js';
import { RecordStatus } from '../../../common/enums/record-status.enum.js';
import { PaymentMethodType } from '../entities/payment-method-type.enum.js';

registerEnumType(PaymentMethodType, {
  name: 'PaymentMethodType',
  description: 'Tipo de medio de pago: efectivo, tarjeta o transferencia',
});

@ObjectType('PaymentMethod')
export class PaymentMethodObjectType extends BaseObjectType {
  @Field()
  companyId: string;

  @Field()
  name: string;

  @Field(() => PaymentMethodType)
  type: PaymentMethodType;

  // Si es true, cobrar con este medio exige una referencia
  @Field()
  requiresReference: boolean;

  @Field(() => RecordStatus)
  status: RecordStatus;
}
