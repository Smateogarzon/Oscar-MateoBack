import { Field, ID, InputType } from '@nestjs/graphql';
import { IsUUID, Matches } from 'class-validator';
import { QUANTITY_PATTERN } from '../../../common/utils/money.js';

// Solo cambia la cantidad: el precio y la descripción de la línea se quedan como están. El total
// de la línea y los de la venta los recalcula el servidor. Como el resto de montos, la cantidad
// viaja como texto (ver AddSaleItemInput).
@InputType()
export class UpdateSaleItemQuantityInput {
  // Venta (en borrador) a la que pertenece la línea
  @Field(() => ID)
  @IsUUID()
  saleId: string;

  @Field(() => ID)
  @IsUUID()
  itemId: string;

  // La nueva cantidad, mayor que cero, ej: "3" o "1.5"
  @Field()
  @Matches(QUANTITY_PATTERN, {
    message: 'quantity debe ser una cantidad con hasta 2 decimales, por ejemplo 2 o 1.5',
  })
  quantity: string;
}
