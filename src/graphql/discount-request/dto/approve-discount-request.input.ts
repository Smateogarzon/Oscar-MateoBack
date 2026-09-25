import { Field, InputType } from '@nestjs/graphql';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  ValidateNested,
} from 'class-validator';
import { MONEY_PATTERN } from '../../../common/utils/money.js';
import { DiscountItemAmountInput } from './discount-item-amount.input.js';

// Los montos que decide el administrador, dentro del tope del 30 % del valor de la venta o de cada
// línea (puede pasar de lo que pidió el cajero). Según el tipo de la solicitud se envía UNO de
// dos: `approvedDiscount` si es sobre toda la venta, o `items` si es sobre líneas. Al aprobar, lo
// que no se envía se aprueba como se pidió; al editar, lo que no se envía se queda como estaba.
@InputType()
export class ApproveDiscountRequestInput {
  // Monto sobre toda la venta (solicitudes sobre toda la venta)
  @Field({ nullable: true })
  @IsOptional()
  @Matches(MONEY_PATTERN, {
    message: 'approvedDiscount debe ser un monto con hasta 2 decimales, por ejemplo 30000',
  })
  approvedDiscount?: string;

  // Monto de cada línea que se quiere fijar (solicitudes sobre líneas); "0" deja una sin descuento
  @Field(() => [DiscountItemAmountInput], { nullable: true })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(200)
  @ValidateNested({ each: true })
  @Type(() => DiscountItemAmountInput)
  items?: DiscountItemAmountInput[];

  @Field({ nullable: true })
  @IsOptional()
  @IsString()
  @MaxLength(255)
  notes?: string;
}
