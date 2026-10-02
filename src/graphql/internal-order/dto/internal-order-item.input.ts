import { Field, ID, InputType } from '@nestjs/graphql';
import { IsOptional, IsString, IsUUID, Matches, MaxLength } from 'class-validator';
import { Trim } from '../../../common/decorators/trim.decorator.js';
import { MONEY_PATTERN, QUANTITY_PATTERN } from '../../../common/utils/money.js';

// `unitPrice`/`discountAmount` solo importan en un pedido CUSTOMER_REQUEST (ver la entidad); en
// los demás tipos se ignoran si vienen.
@InputType()
export class InternalOrderItemInput {
  @Field(() => ID)
  @IsUUID()
  productVariantId: string;

  @Field()
  @Matches(QUANTITY_PATTERN, {
    message: 'quantity debe ser una cantidad con hasta 2 decimales, por ejemplo 2 o 1.5',
  })
  quantity: string;

  @Field({ nullable: true })
  @IsOptional()
  @Matches(MONEY_PATTERN, {
    message: 'unitPrice debe ser un monto de hasta 12 dígitos enteros y hasta 2 decimales, por ejemplo 89900',
  })
  unitPrice?: string;

  @Field({ nullable: true })
  @IsOptional()
  @Matches(MONEY_PATTERN, {
    message: 'discountAmount debe ser un monto de hasta 12 dígitos enteros y hasta 2 decimales',
  })
  discountAmount?: string;

  @Field({ nullable: true })
  @IsOptional()
  @Trim()
  @IsString()
  @MaxLength(255)
  notes?: string;
}
