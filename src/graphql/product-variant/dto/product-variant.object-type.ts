import { Decimal } from 'decimal.js';
import { Field, ObjectType } from '@nestjs/graphql';
import { BaseObjectType } from '../../../common/dto/base.object-type.js';
import '../../../common/dto/record-status.enum-type.js';
import { RecordStatus } from '../../../common/enums/record-status.enum.js';

@ObjectType('ProductVariant')
export class ProductVariantObjectType extends BaseObjectType {
  @Field()
  companyId: string;

  @Field()
  productId: string;

  @Field()
  colorId: string;

  @Field()
  sizeId: string;

  @Field()
  sku: string;

  @Field(() => Decimal)
  cost: Decimal;

  @Field(() => Decimal)
  price: Decimal;

  @Field(() => String, { nullable: true })
  imageUrl: string | null;

  @Field(() => RecordStatus)
  status: RecordStatus;
}
