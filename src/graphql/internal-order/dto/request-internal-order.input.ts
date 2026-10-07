import { Type } from 'class-transformer';
import { Field, ID, InputType } from '@nestjs/graphql';
import { ArrayMaxSize, ArrayMinSize, IsArray, IsIn, IsEnum, IsOptional, IsString, IsUUID, Matches, MaxLength, ValidateNested } from 'class-validator';
import { Trim } from '../../../common/decorators/trim.decorator.js';
import { QUANTITY_PATTERN } from '../../../common/utils/money.js';
import { InternalOrderOrigin } from '../entities/internal-order-origin.enum.js';
import { InternalOrderType } from '../entities/internal-order-type.enum.js';

@InputType()
export class InternalOrderLineInput {
  @Field(() => ID)
  @IsUUID()
  productVariantId: string;

  @Field()
  @Matches(QUANTITY_PATTERN, { message: 'quantity debe ser una cantidad con hasta 2 decimales, por ejemplo 2' })
  quantity: string;

  @Field({ nullable: true })
  @IsOptional()
  @Trim()
  @IsString()
  @MaxLength(255)
  notes?: string;
}

// Pedir una orden: una SO (el vendedor pide a bodega), o un TR / RS (Inventario → Transferencia). La
// RE no se pide así: nace de una SO (el cliente no compra, o un cambio de pedido). El precio de cada
// línea de una SO lo pone el servidor (el de la variante): no lo decide quien pide.
@InputType()
export class RequestInternalOrderInput {
  @Field(() => InternalOrderType)
  @IsEnum(InternalOrderType)
  @IsIn([InternalOrderType.SO, InternalOrderType.TR, InternalOrderType.RS], { message: 'Una devolución nace de su orden de venta' })
  type: Exclude<InternalOrderType, InternalOrderType.RE>;

  @Field(() => InternalOrderOrigin)
  @IsEnum(InternalOrderOrigin)
  origin: InternalOrderOrigin;

  @Field(() => ID)
  @IsUUID()
  sourceLocationId: string;

  @Field(() => ID)
  @IsUUID()
  destinationLocationId: string;

  // Dónde, dentro del destino, lo entrega el corredor ("Probador #02").
  @Field({ nullable: true })
  @IsOptional()
  @Trim()
  @IsString()
  @MaxLength(80)
  deliveryPoint?: string;

  @Field({ nullable: true })
  @IsOptional()
  @Trim()
  @IsString()
  @MaxLength(500)
  notes?: string;

  @Field(() => [InternalOrderLineInput])
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(100)
  @ValidateNested({ each: true })
  @Type(() => InternalOrderLineInput)
  items: InternalOrderLineInput[];
}
