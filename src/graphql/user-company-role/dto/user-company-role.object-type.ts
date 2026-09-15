import { Field, ObjectType } from '@nestjs/graphql';
import { BaseObjectType } from '../../../common/dto/base.object-type.js';
import '../../../common/dto/record-status.enum-type.js';
import { RecordStatus } from '../../../common/enums/record-status.enum.js';

@ObjectType('UserCompanyRole')
export class UserCompanyRoleObjectType extends BaseObjectType {
  @Field()
  userId: string;

  @Field()
  companyId: string;

  @Field()
  roleId: string;

  @Field(() => RecordStatus)
  status: RecordStatus;
}
