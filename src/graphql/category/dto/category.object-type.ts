import { Field, ID, ObjectType } from '@nestjs/graphql';
import { BaseObjectType } from '../../../common/dto/base.object-type.js';
import '../../../common/dto/record-status.enum-type.js';
import { RecordStatus } from '../../../common/enums/record-status.enum.js';

@ObjectType('Category')
export class CategoryObjectType extends BaseObjectType {
  @Field()
  companyId: string;

  @Field()
  name: string;

  @Field()
  slug: string;

  @Field(() => ID, { nullable: true })
  parentId: string | null;

  @Field(() => String, { nullable: true })
  description: string | null;

  @Field(() => RecordStatus)
  status: RecordStatus;
}
