import { Field, ID, InputType } from '@nestjs/graphql';
import { IsUUID, Matches } from 'class-validator';

// Una cantidad con hasta 2 decimales, o vacío para quitar el mínimo (mismo patrón que `minStock` en
// CreateInventoryMovementInput).
const MIN_STOCK_PATTERN = /^$|^\d{1,10}(\.\d{1,2})?$/;

@InputType()
export class UpdateInventoryBalanceMinStockInput {
  @Field(() => ID)
  @IsUUID()
  id: string;

  // Debajo de esta cantidad la existencia se considera baja; "" quita el mínimo y con él la alerta.
  @Field()
  @Matches(MIN_STOCK_PATTERN, {
    message: 'minStock debe ser una cantidad con hasta 2 decimales, por ejemplo 2 o 1.5, o vacío para quitarlo',
  })
  minStock: string;
}
