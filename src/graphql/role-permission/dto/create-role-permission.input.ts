import { Field, ID, InputType } from '@nestjs/graphql';
import { IsUUID } from 'class-validator';

@InputType()
export class CreateRolePermissionInput {
  @Field(() => ID)
  @IsUUID()
  roleId: string;

  @Field(() => ID)
  @IsUUID()
  permissionId: string;
}
