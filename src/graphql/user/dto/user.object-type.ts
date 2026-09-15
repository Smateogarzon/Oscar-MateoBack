import { Field, ObjectType } from '@nestjs/graphql';
import { BaseObjectType } from '../../../common/dto/base.object-type.js';
import '../../../common/dto/record-status.enum-type.js';
import { RecordStatus } from '../../../common/enums/record-status.enum.js';

// passwordHash queda fuera a propósito: nunca se expone por GraphQL
@ObjectType('User')
export class UserObjectType extends BaseObjectType {
  @Field()
  firstName: string;

  @Field()
  lastName: string;

  @Field()
  email: string;

  @Field({ nullable: true })
  phone: string | null;

  @Field({ nullable: true })
  documentNumber: string | null;

  @Field({ nullable: true })
  avatarUrl: string | null;

  @Field(() => RecordStatus)
  status: RecordStatus;

  @Field()
  mustChangePassword: boolean;

  @Field({ nullable: true })
  lastLoginAt: Date | null;
}
