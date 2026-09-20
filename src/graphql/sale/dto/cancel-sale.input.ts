import { Field, InputType } from '@nestjs/graphql';
import { IsNotEmpty, IsString, MaxLength } from 'class-validator';

@InputType()
export class CancelSaleInput {
  // Por qué se cancela la venta; queda guardado junto con quién y cuándo
  @Field()
  @IsString()
  @IsNotEmpty()
  @MaxLength(255)
  reason: string;
}
