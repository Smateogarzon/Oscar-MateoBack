import { Field, ID, InputType } from '@nestjs/graphql';
import { IsNotEmpty, IsString, IsUUID, MaxLength } from 'class-validator';

// El código de la caja (C1, C2, C3...) no se manda: lo asigna el servidor al crearla, en orden dentro
// de la tienda (ver nextCashRegisterCode).
@InputType()
export class CreateCashRegisterInput {
  // Tienda (no bodega) donde está la caja
  @Field(() => ID)
  @IsUUID()
  storeId: string;

  @Field()
  @IsString()
  @IsNotEmpty()
  @MaxLength(80)
  name: string;
}
