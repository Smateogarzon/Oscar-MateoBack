import { Decimal } from 'decimal.js';
import { Field, ID, ObjectType, registerEnumType } from '@nestjs/graphql';
import { ImmutableObjectType } from '../../../common/dto/immutable.object-type.js';
import { InventoryMovementType } from '../entities/inventory-movement-type.enum.js';
import { InventorySourceType } from '../entities/inventory-source-type.enum.js';

registerEnumType(InventoryMovementType, {
  name: 'InventoryMovementType',
  description: 'Por qué se movió la existencia',
});
registerEnumType(InventorySourceType, {
  name: 'InventorySourceType',
  description: 'De qué documento salió un movimiento o una reserva',
});

@ObjectType('InventoryMovement')
export class InventoryMovementObjectType extends ImmutableObjectType {
  @Field()
  companyId: string;

  @Field()
  productVariantId: string;

  @Field(() => ID, { nullable: true })
  fromLocationId: string | null;

  @Field(() => ID, { nullable: true })
  toLocationId: string | null;

  @Field(() => Decimal)
  quantity: Decimal;

  @Field(() => InventoryMovementType)
  type: InventoryMovementType;

  @Field(() => InventorySourceType)
  sourceType: InventorySourceType;

  @Field(() => ID, { nullable: true })
  sourceId: string | null;

  @Field(() => String, { nullable: true })
  sourceNumber: string | null;

  @Field(() => String, { nullable: true })
  notes: string | null;

  @Field()
  createdBy: string;
}
