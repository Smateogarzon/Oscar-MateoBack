import { Field, ID, InputType } from '@nestjs/graphql';
import { IsUUID } from 'class-validator';

@InputType()
export class CreateUserLocationAccessInput {
  @Field(() => ID)
  @IsUUID()
  userId: string;

  @Field(() => ID)
  @IsUUID()
  locationId: string;
}
