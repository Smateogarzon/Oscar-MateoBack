import { Field, ObjectType } from '@nestjs/graphql';
import { BaseObjectType } from '../../../common/dto/base.object-type.js';
import '../../../common/dto/record-status.enum-type.js';
import { RecordStatus } from '../../../common/enums/record-status.enum.js';

@ObjectType('CashRegister')
export class CashRegisterObjectType extends BaseObjectType {
  @Field()
  storeId: string;

  @Field()
  name: string;

  @Field()
  code: string;

  @Field(() => RecordStatus)
  status: RecordStatus;
}
