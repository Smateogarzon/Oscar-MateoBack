import { Field, ID, InputType } from '@nestjs/graphql';
import { IsNotEmpty, IsOptional, IsString, IsUUID, IsUrl, Matches, MaxLength } from 'class-validator';
import { Trim } from '../../../common/decorators/trim.decorator.js';
import { MONEY_PATTERN } from '../../../common/utils/money.js';

// Los montos viajan como texto y se convierten a Decimal en el servicio (ver AddSaleItemInput):
// el ValidationPipe recorre los inputs con class-transformer, que no sabe copiar Decimal.
@InputType()
export class CreateProductVariantInput {
  @Field(() => ID)
  @IsUUID()
  productId: string;

  @Field(() => ID)
  @IsUUID()
  colorId: string;

  @Field(() => ID)
  @IsUUID()
  sizeId: string;

  @Field()
  @Trim()
  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  sku: string;

  @Field()
  @Matches(MONEY_PATTERN, {
    message: 'cost debe ser un monto de hasta 12 dígitos enteros y hasta 2 decimales, por ejemplo 35000',
  })
  cost: string;

  @Field()
  @Matches(MONEY_PATTERN, {
    message: 'price debe ser un monto de hasta 12 dígitos enteros y hasta 2 decimales, por ejemplo 89900',
  })
  price: string;

  @Field({ nullable: true })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  @IsUrl({ require_protocol: true, protocols: ['http', 'https'], require_tld: false })
  imageUrl?: string;
}
