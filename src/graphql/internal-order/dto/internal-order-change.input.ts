import { Type } from 'class-transformer';
import { Field, ID, InputType } from '@nestjs/graphql';
import { ArrayMinSize, IsArray, IsUUID, Matches, ValidateNested } from 'class-validator';
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

// Cambio de pedido: las líneas que se cambian y la bodega que despacha lo nuevo.
@InputType()
export class InternalOrderChangeInput {
  @Field(() => ID)
  @IsUUID()
  orderId: string;

  @Field(() => ID)
  @IsUUID()
  sourceLocationId: string;

  @Field(() => [InternalOrderChangeLineInput])
  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => InternalOrderChangeLineInput)
  lines: InternalOrderChangeLineInput[];
}
