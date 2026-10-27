import { Decimal } from 'decimal.js';
import { Field, ID, ObjectType } from '@nestjs/graphql';

// No extiende BaseObjectType/ImmutableObjectType: la tabla no tiene createdAt (ver la entidad).
@ObjectType('InventoryBalance')
export class InventoryBalanceObjectType {
  @Field(() => ID)
  id: string;

  @Field()
  productVariantId: string;

  @Field()
  inventoryLocationId: string;

  @Field(() => Decimal)
  quantity: Decimal;

  @Field(() => String, { nullable: true })
  position: string | null;

  @Field(() => Decimal, { nullable: true })
  minStock: Decimal | null;

  @Field(() => Date)
  updatedAt: Date;
}
