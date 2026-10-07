import { Field, ID, InputType } from '@nestjs/graphql';
import { IsUUID, Matches } from 'class-validator';
import { QUANTITY_PATTERN } from '../../../common/utils/money.js';

// Lo contado de una línea de la orden, en cualquiera de los dos conteos del recorrido: el del
// proveedor al despachar (va una por CADA línea; la que no llega se manda en 0 y eso abre su
// novedad) y el del bodeguero al recibir (va una por cada línea despachada, y es esa cifra —no la
// del proveedor— la que entra al inventario). Ver purchase-order-lines.ts.
@InputType()
export class PurchaseOrderItemCountInput {
  @Field(() => ID)
  @IsUUID()
  itemId: string;

  @Field()
  @Matches(QUANTITY_PATTERN, {
    message: 'quantity debe ser una cantidad con hasta 2 decimales, por ejemplo 12 o 1.5',
  })
  quantity: string;
}
