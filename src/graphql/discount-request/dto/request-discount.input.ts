import { Field, ID, InputType } from '@nestjs/graphql';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  MaxLength,
  ValidateNested,
} from 'class-validator';
import { MONEY_PATTERN } from '../../../common/utils/money.js';
import { DiscountItemAmountInput } from './discount-item-amount.input.js';

// Se pide el descuento de UNA de dos formas, nunca las dos: sobre toda la venta (`requestedDiscount`,
// un solo monto) o sobre líneas (`items`, cada línea con su propio monto). En ambos casos el tope
// es el 30 % del valor de la venta o de cada línea.
// Los montos viajan como texto y se convierten a Decimal en el servicio: el ValidationPipe global
// recorre los inputs con class-transformer, que no sabe copiar instancias de Decimal.
@InputType()
export class RequestDiscountInput {
  // Venta (en borrador) sobre la que se pide el descuento
  @Field(() => ID)
  @IsUUID()
  saleId: string;

  // Monto a descontar sobre toda la venta, ej: "30000"
  @Field({ nullable: true })
  @IsOptional()
  @Matches(MONEY_PATTERN, {
    message: 'requestedDiscount debe ser un monto con hasta 2 decimales, por ejemplo 30000',
  })
  requestedDiscount?: string;

  // Descuento de una o varias líneas, cada una con su monto
  @Field(() => [DiscountItemAmountInput], { nullable: true })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(200)
  @ValidateNested({ each: true })
  @Type(() => DiscountItemAmountInput)
  items?: DiscountItemAmountInput[];

  // Por qué se pide, para quien tiene que aprobarlo
  @Field({ nullable: true })
  @IsOptional()
  @IsString()
  @MaxLength(255)
  reason?: string;
}
