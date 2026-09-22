import { Field, ID, InputType } from '@nestjs/graphql';
import { IsOptional, IsUUID } from 'class-validator';

// El cajero es quien la crea (el usuario de la sesión) y la empresa es la activa: no se piden.
// internalOrderId todavía no se acepta: no hay pedidos internos contra los que validarlo.
@InputType()
export class CreateSaleInput {
  // Tienda donde se hace la venta
  @Field(() => ID)
  @IsUUID()
  storeId: string;

  // Turno de caja (abierto, de una caja de esta tienda, del cajero que crea la venta) al que
  // queda atado desde que nace: así el turno ve sus borradores desde el principio, no solo al
  // cobrarlos.
  @Field(() => ID)
  @IsUUID()
  cashSessionId: string;

  // Quien atendió al cliente, si es otra persona que el cajero
  @Field(() => ID, { nullable: true })
  @IsOptional()
  @IsUUID()
  sellerId?: string;
}
