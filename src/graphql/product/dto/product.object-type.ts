import { Field, ID, ObjectType } from '@nestjs/graphql';
import { BaseObjectType } from '../../../common/dto/base.object-type.js';
import '../../../common/dto/record-status.enum-type.js';
import { RecordStatus } from '../../../common/enums/record-status.enum.js';

@ObjectType('Product')
export class ProductObjectType extends BaseObjectType {
  @Field()
  companyId: string;

  @Field(() => ID, { nullable: true })
  brandId: string | null;

  @Field()
  categoryId: string;

  @Field()
  name: string;

  @Field()
  reference: string;

  @Field(() => String, { nullable: true })
  description: string | null;

  @Field(() => RecordStatus)
  status: RecordStatus;
}
