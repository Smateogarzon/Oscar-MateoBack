import { Decimal } from 'decimal.js';
import { Field, ID, ObjectType } from '@nestjs/graphql';
import { ImmutableObjectType } from '../../../common/dto/immutable.object-type.js';
import '../../inventory-balance/entities/inventory-side.enum-type.js';
import { InventorySide } from '../../inventory-balance/entities/inventory-side.enum.js';
import { InventorySourceType } from '../../inventory-movement/entities/inventory-source-type.enum.js';

@ObjectType('InventoryReservation')
export class InventoryReservationObjectType extends ImmutableObjectType {
  @Field()
  productVariantId: string;

  @Field()
  inventoryLocationId: string;

  @Field(() => InventorySide)
  side: InventorySide;

  @Field(() => Decimal)
  quantity: Decimal;

  @Field(() => InventorySourceType)
  sourceType: InventorySourceType;

  @Field(() => ID)
  sourceId: string;

  @Field(() => String, { nullable: true })
  sourceNumber: string | null;
}
