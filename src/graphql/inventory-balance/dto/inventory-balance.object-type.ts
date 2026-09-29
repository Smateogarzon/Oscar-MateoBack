import { Decimal } from 'decimal.js';
import { Field, ID, ObjectType } from '@nestjs/graphql';
import '../entities/inventory-side.enum-type.js';
import { InventorySide } from '../entities/inventory-side.enum.js';

// No extiende BaseObjectType/ImmutableObjectType: la tabla no tiene createdAt (ver la entidad).
@ObjectType('InventoryBalance')
export class InventoryBalanceObjectType {
  @Field(() => ID)
  id: string;

  @Field()
  productVariantId: string;

  @Field()
  inventoryLocationId: string;

  @Field(() => InventorySide)
  side: InventorySide;

  @Field(() => Decimal)
  quantity: Decimal;

  @Field(() => Date)
  updatedAt: Date;
}
