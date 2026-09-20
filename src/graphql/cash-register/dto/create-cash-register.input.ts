import { Field, ID, InputType } from '@nestjs/graphql';
import { IsNotEmpty, IsString, IsUUID, MaxLength } from 'class-validator';

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

  // Código corto dentro de la tienda, ej: "C1"
  @Field()
  @IsString()
  @IsNotEmpty()
  @MaxLength(30)
  code: string;
}
