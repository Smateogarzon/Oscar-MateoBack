import { Field, ObjectType } from '@nestjs/graphql';
import { BaseObjectType } from '../../../common/dto/base.object-type.js';
import '../../../common/dto/record-status.enum-type.js';
import { RecordStatus } from '../../../common/enums/record-status.enum.js';

@ObjectType('Brand')
export class BrandObjectType extends BaseObjectType {
  @Field()
  name: string;

  @Field()
  slug: string;

  @Field(() => String, { nullable: true })
  logoUrl: string | null;

  @Field(() => RecordStatus)
  status: RecordStatus;
}
