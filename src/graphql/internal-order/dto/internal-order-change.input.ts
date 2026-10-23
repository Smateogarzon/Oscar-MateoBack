import { Type } from 'class-transformer';
import { Field, ID, InputType } from '@nestjs/graphql';
import { ArrayMinSize, IsArray, IsOptional, IsUUID, Matches, ValidateNested } from 'class-validator';
import { QUANTITY_PATTERN } from '../../../common/utils/money.js';

// Una línea que el cliente cambia: cuál (de la versión vigente) y por qué variante.
@InputType()
export class InternalOrderChangeLineInput {
  @Field(() => ID)
  @IsUUID()
  itemId: string;

  @Field(() => ID)
  @IsUUID()
  productVariantId: string;

  @Field()
  @Matches(QUANTITY_PATTERN, { message: 'quantity debe ser una cantidad con hasta 2 decimales' })
  quantity: string;
}

// Cambio de pedido: las líneas que se cambian. La bodega que despacha lo nuevo NO se pide: la elige
// el servidor con lo que hay disponible, igual que en un pedido normal (ver `InternalOrderService.
// requestChange`). `sourceLocationId` queda solo por compatibilidad con quien todavía lo mande, y
// cuando viene se respeta.
@InputType()
export class InternalOrderChangeInput {
  @Field(() => ID)
  @IsUUID()
  orderId: string;

  @Field(() => ID, { nullable: true })
  @IsOptional()
  @IsUUID()
  sourceLocationId?: string;

  @Field(() => [InternalOrderChangeLineInput])
  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => InternalOrderChangeLineInput)
  lines: InternalOrderChangeLineInput[];
}
