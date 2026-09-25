import { Field, ID, InputType } from '@nestjs/graphql';
import { IsUUID, Matches } from 'class-validator';
import { QUANTITY_PATTERN } from '../../../common/utils/money.js';

// Una línea de la venta original que se devuelve. La cantidad viaja como texto y se convierte a
// Decimal en el servicio (ver AddSaleItemInput). Lo que vale lo devuelto lo calcula el servidor.
@InputType()
export class SaleReturnItemInput {
  @Field(() => ID)
  @IsUUID()
  saleItemId: string;

  // Cuántas unidades se devuelven, ej: "1" o "0.5"
  @Field()
  @Matches(QUANTITY_PATTERN, {
    message: 'quantity debe ser una cantidad con hasta 2 decimales, por ejemplo 1 o 0.5',
  })
  quantity: string;
}
