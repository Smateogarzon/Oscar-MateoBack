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

  // Esta mercancía vive en la tienda y no pasa por corredor (ver `Category.directSale`). Se hereda
  // a las subcategorías: este campo dice lo que quedó marcado en ESTA, no lo heredado.
  @Field()
  directSale: boolean;

  @Field(() => RecordStatus)
  status: RecordStatus;
}
