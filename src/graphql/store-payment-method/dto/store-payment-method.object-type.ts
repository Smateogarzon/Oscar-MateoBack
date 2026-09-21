import { Field, ObjectType } from '@nestjs/graphql';
import { ImmutableObjectType } from '../../../common/dto/immutable.object-type.js';
import '../../../common/dto/record-status.enum-type.js';
import { RecordStatus } from '../../../common/enums/record-status.enum.js';

@ObjectType('StorePaymentMethod')
export class StorePaymentMethodObjectType extends ImmutableObjectType {
  @Field()
  storeId: string;

  @Field()
  paymentMethodId: string;

  @Field(() => RecordStatus)
  status: RecordStatus;
}
