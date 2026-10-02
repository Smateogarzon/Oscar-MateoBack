import { Decimal } from 'decimal.js';
import { Field, ID, ObjectType } from '@nestjs/graphql';

// Un resultado del buscador de Ventas (ver ProductVariantService.search): lo justo para mostrarlo
// en la lista y agregar la línea, sin traer Product/Color/Size completos.
@ObjectType('ProductVariantSearchResult')
export class ProductVariantSearchResultObjectType {
  @Field(() => ID)
  id: string;

  @Field(() => ID)
  productId: string;

  @Field()
  productName: string;

  @Field()
  reference: string;

  @Field()
  sku: string;

  @Field()
  colorName: string;

  @Field()
  sizeName: string;

  @Field(() => Decimal)
  price: Decimal;

  @Field(() => String, { nullable: true })
  imageUrl: string | null;
}
