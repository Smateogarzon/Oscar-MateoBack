import { Field, ID, InputType } from '@nestjs/graphql';
import { IsOptional, IsUUID, Matches } from 'class-validator';
import { MONEY_PATTERN } from '../../../common/utils/money.js';

// El monto viaja como texto y se convierte a Decimal en el servicio (ver AddSaleItemInput). Lo
// abre el administrador, no el cajero.
@InputType()
export class OpenCashSessionInput {
  // Caja (activa) cuyo turno se abre
  @Field(() => ID)
  @IsUUID()
  cashRegisterId: string;

  // El cajero que trabajará el turno: el único que cobra y mueve dinero en él. Debe ser un miembro
  // de la empresa con permiso para cobrar y acceso a la tienda de la caja.
  @Field(() => ID)
  @IsUUID()
  cashierId: string;

  // Efectivo con el que arranca la caja, ej: "200000". Si no se indica, cero.
  @Field({ nullable: true })
  @IsOptional()
  @Matches(MONEY_PATTERN, {
    message: 'openingAmount debe ser un monto con hasta 2 decimales, por ejemplo 200000',
  })
  openingAmount?: string;
}
