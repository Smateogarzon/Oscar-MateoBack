import { Field, ID, InputType } from '@nestjs/graphql';
import { IsUUID, Matches } from 'class-validator';

// Una cantidad con hasta 2 decimales, o vacío para quitar el mínimo (mismo patrón que `minStock` en
// UpdateInventoryBalanceMinStockInput).
const MIN_QUANTITY_PATTERN = /^$|^\d{1,10}(\.\d{1,2})?$/;

@InputType()
export class SetStoreModelMinimumInput {
  /** La tienda. Una bodega no tiene mostrador y se rechaza. */
  @Field(() => ID)
  @IsUUID()
  locationId: string;

  @Field(() => ID)
  @IsUUID()
  productId: string;

  @Field(() => ID)
  @IsUUID()
  colorId: string;

  // Cuántas unidades del modelo debe haber en el mostrador; "" quita el mínimo y con él la alerta.
  @Field()
  @Matches(MIN_QUANTITY_PATTERN, {
    message: 'minQuantity debe ser una cantidad con hasta 2 decimales, por ejemplo 6, o vacío para quitarlo',
  })
  minQuantity: string;
}
