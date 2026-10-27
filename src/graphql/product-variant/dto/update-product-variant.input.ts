import { Field, ID, InputType } from '@nestjs/graphql';
import { IsNotEmpty, IsOptional, IsString, IsUUID, IsUrl, Matches, MaxLength } from 'class-validator';
import { Trim } from '../../../common/decorators/trim.decorator.js';
import { MONEY_PATTERN } from '../../../common/utils/money.js';

@InputType()
export class UpdateProductVariantInput {
  @Field(() => ID, { nullable: true })
  @IsOptional()
  @IsUUID()
  colorId?: string;

  @Field(() => ID, { nullable: true })
  @IsOptional()
  @IsUUID()
  sizeId?: string;

  @Field({ nullable: true })
  @IsOptional()
  @Trim()
  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  sku?: string;

  @Field({ nullable: true })
  @IsOptional()
  @Matches(MONEY_PATTERN, {
    message: 'cost debe ser un monto de hasta 12 dígitos enteros y hasta 2 decimales, por ejemplo 35000',
  })
  cost?: string;

  @Field({ nullable: true })
  @IsOptional()
  @Matches(MONEY_PATTERN, {
    message: 'price debe ser un monto de hasta 12 dígitos enteros y hasta 2 decimales, por ejemplo 89900',
  })
  price?: string;

  // `null` le quita la imagen a la variante.
  @Field(() => String, { nullable: true })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  @IsUrl({ require_protocol: true, protocols: ['http', 'https'], require_tld: false })
  imageUrl?: string | null;
}
