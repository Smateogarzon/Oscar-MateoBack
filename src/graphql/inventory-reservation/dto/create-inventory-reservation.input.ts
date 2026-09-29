import { Field, ID, InputType } from '@nestjs/graphql';
import { IsEnum, IsOptional, IsString, IsUUID, Matches, MaxLength } from 'class-validator';
import { Trim } from '../../../common/decorators/trim.decorator.js';
import { QUANTITY_PATTERN } from '../../../common/utils/money.js';
import { InventorySide } from '../../inventory-balance/entities/inventory-side.enum.js';
import { InventorySourceType } from '../../inventory-movement/entities/inventory-source-type.enum.js';

@InputType()
export class CreateInventoryReservationInput {
  @Field(() => ID)
  @IsUUID()
  productVariantId: string;

  @Field(() => ID)
  @IsUUID()
  inventoryLocationId: string;

  @Field(() => InventorySide)
  @IsEnum(InventorySide)
  side: InventorySide;

  @Field()
  @Matches(QUANTITY_PATTERN, {
    message: 'quantity debe ser una cantidad con hasta 2 decimales, por ejemplo 2 o 1.5',
  })
  quantity: string;

  @Field(() => InventorySourceType)
  @IsEnum(InventorySourceType)
  sourceType: InventorySourceType;

  @Field(() => ID)
  @IsUUID()
  sourceId: string;

  @Field({ nullable: true })
  @IsOptional()
  @Trim()
  @IsString()
  @MaxLength(50)
  sourceNumber?: string;
}
