import { Field, ID, InputType } from '@nestjs/graphql';
import { IsEnum, IsOptional, IsString, IsUUID, Matches, MaxLength } from 'class-validator';
import { Trim } from '../../../common/decorators/trim.decorator.js';
import { QUANTITY_PATTERN } from '../../../common/utils/money.js';
import { InventorySide } from '../../inventory-balance/entities/inventory-side.enum.js';
import { InventoryMovementType } from '../entities/inventory-movement-type.enum.js';
import { InventorySourceType } from '../entities/inventory-source-type.enum.js';

// La cantidad viaja como texto y se convierte a Decimal en el servicio (ver AddSaleItemInput): el
// ValidationPipe recorre los inputs con class-transformer, que no sabe copiar Decimal.
@InputType()
export class CreateInventoryMovementInput {
  @Field(() => ID)
  @IsUUID()
  productVariantId: string;

  // Sin ella, el movimiento entra al sistema desde fuera (una compra, el cargue inicial).
  @Field(() => ID, { nullable: true })
  @IsOptional()
  @IsUUID()
  fromLocationId?: string;

  // Sin ella, el movimiento sale del sistema (una venta).
  @Field(() => ID, { nullable: true })
  @IsOptional()
  @IsUUID()
  toLocationId?: string;

  @Field(() => InventorySide)
  @IsEnum(InventorySide)
  side: InventorySide;

  // Debe ser mayor que cero, ej: "2" o "1.5"
  @Field()
  @Matches(QUANTITY_PATTERN, {
    message: 'quantity debe ser una cantidad con hasta 2 decimales, por ejemplo 2 o 1.5',
  })
  quantity: string;

  @Field(() => InventoryMovementType)
  @IsEnum(InventoryMovementType)
  type: InventoryMovementType;

  @Field(() => InventorySourceType)
  @IsEnum(InventorySourceType)
  sourceType: InventorySourceType;

  @Field(() => ID, { nullable: true })
  @IsOptional()
  @IsUUID()
  sourceId?: string;

  @Field({ nullable: true })
  @IsOptional()
  @Trim()
  @IsString()
  @MaxLength(50)
  sourceNumber?: string;

  @Field({ nullable: true })
  @IsOptional()
  @Trim()
  @IsString()
  @MaxLength(255)
  notes?: string;
}
