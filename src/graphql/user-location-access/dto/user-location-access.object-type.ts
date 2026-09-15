import { Field, ObjectType } from '@nestjs/graphql';
import { ImmutableObjectType } from '../../../common/dto/immutable.object-type.js';
import '../../../common/dto/record-status.enum-type.js';
import { RecordStatus } from '../../../common/enums/record-status.enum.js';

@ObjectType('UserLocationAccess')
export class UserLocationAccessObjectType extends ImmutableObjectType {
  @Field()
  userId: string;

  @Field()
  locationId: string;

  @Field(() => RecordStatus)
  status: RecordStatus;
}
