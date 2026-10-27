import { Field, ID, InputType } from '@nestjs/graphql';
import { IsBoolean, IsUUID } from 'class-validator';

// Qué decide el administrador sobre el sobrante de UNA línea: aceptarlo (esa mercancía de más
// entra cuando bodega la reciba) o rechazarlo. Basta con que rechace una para que el despacho
// entero vuelva al proveedor (ver PurchaseOrderService.resolveOverage).
@InputType()
export class PurchaseOrderOverageDecisionInput {
  @Field(() => ID)
  @IsUUID()
  itemId: string;

  @Field()
  @IsBoolean()
  accepted: boolean;
}
