import { Field, ID, InputType } from '@nestjs/graphql';
import { IsUUID, Matches } from 'class-validator';
import { QUANTITY_PATTERN } from '../../../common/utils/money.js';

// Cuánto se encontró de una línea al alistar, o cuánto se contó al recibir una devolución en bodega.
// Puede ser 0; nunca más de lo que tiene la línea.
@InputType()
export class InternalOrderLineCountInput {
  @Field(() => ID)
  @IsUUID()
  itemId: string;

  @Field()
  @Matches(QUANTITY_PATTERN, { message: 'quantity debe ser una cantidad con hasta 2 decimales (puede ser 0)' })
  quantity: string;
}
