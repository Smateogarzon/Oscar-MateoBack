import { Field, ID, InputType } from '@nestjs/graphql';
import { IsUUID } from 'class-validator';

@InputType()
export class CreateUserCompanyRoleInput {
  @Field(() => ID)
  @IsUUID()
  userId: string;

  @Field(() => ID)
  @IsUUID()
  companyId: string;

  @Field(() => ID)
  @IsUUID()
  roleId: string;
}
