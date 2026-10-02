import { Field, ID, InputType } from '@nestjs/graphql';
import { IsUUID, Matches } from 'class-validator';
import { QUANTITY_PATTERN } from '../../../common/utils/money.js';

// Lo que bodega de verdad encontró de una línea, al dejar el pedido READY.
@InputType()
export class InternalOrderItemFoundInput {
  @Field(() => ID)
  @IsUUID()
  itemId: string;

  @Field()
  @Matches(QUANTITY_PATTERN, {
    message: 'foundQuantity debe ser una cantidad con hasta 2 decimales, por ejemplo 2 o 1.5 (puede ser 0)',
  })
  foundQuantity: string;
}
