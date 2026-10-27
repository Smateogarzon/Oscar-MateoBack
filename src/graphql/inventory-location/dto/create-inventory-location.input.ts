import { Field, ID, InputType } from '@nestjs/graphql';
import { IsEnum, IsOptional, IsUUID } from 'class-validator';
import { InventoryLocationType } from '../entities/inventory-location-type.enum.js';

@InputType()
export class CreateInventoryLocationInput {
  @Field(() => InventoryLocationType)
  @IsEnum(InventoryLocationType)
  type: InventoryLocationType;

  // Obligatoria para STOCK/DISPLAY/DAMAGED/RETURNS; el servicio la exige según el tipo.
  @Field(() => ID, { nullable: true })
  @IsOptional()
  @IsUUID()
  locationId?: string;

  // Obligatorio para RUNNER; el servicio lo exige según el tipo.
  @Field(() => ID, { nullable: true })
  @IsOptional()
  @IsUUID()
  custodianUserId?: string;
}
