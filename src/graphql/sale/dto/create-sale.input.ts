import { Field, ID, InputType } from '@nestjs/graphql';
import { IsOptional, IsUUID } from 'class-validator';

// El cajero es quien la crea (el usuario de la sesión) y la empresa es la activa: no se piden.
// internalOrderId y cashSessionId tampoco se aceptan todavía: no hay pedidos internos ni
// turnos de caja contra los que validarlos.
@InputType()
export class CreateSaleInput {
  // Tienda donde se hace la venta
  @Field(() => ID)
  @IsUUID()
  storeId: string;

  // Quien atendió al cliente, si es otra persona que el cajero
  @Field(() => ID, { nullable: true })
  @IsOptional()
  @IsUUID()
  sellerId?: string;
}
