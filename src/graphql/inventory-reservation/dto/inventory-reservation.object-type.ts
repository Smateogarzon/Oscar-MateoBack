import { Decimal } from 'decimal.js';
import { Field, ID, ObjectType } from '@nestjs/graphql';
import { ImmutableObjectType } from '../../../common/dto/immutable.object-type.js';
import { InventorySourceType } from '../../inventory-movement/entities/inventory-source-type.enum.js';

@ObjectType('InventoryReservation')
export class InventoryReservationObjectType extends ImmutableObjectType {
  @Field()
  productVariantId: string;

  @Field()
  inventoryLocationId: string;

  @Field(() => Decimal)
  quantity: Decimal;

  @Field(() => InventorySourceType)
  sourceType: InventorySourceType;

  @Field(() => ID, { nullable: true })
  sourceId: string | null;

  @Field(() => String, { nullable: true })
  sourceNumber: string | null;

  @Field(() => ID, { nullable: true })
  reservedBy: string | null;

  // Lo resuelve InventoryReservationResolver desde la relación con el usuario.
  @Field(() => String, { nullable: true })
  reservedByName: string | null;
}
