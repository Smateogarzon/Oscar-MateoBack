import { Field, ID, InputType } from '@nestjs/graphql';
import { IsUUID } from 'class-validator';

@InputType()
export class CreateStorePaymentMethodInput {
  @Field(() => ID)
  @IsUUID()
  storeId: string;

  @Field(() => ID)
  @IsUUID()
  paymentMethodId: string;
}
