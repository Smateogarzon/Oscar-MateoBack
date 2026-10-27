import { Field, ObjectType } from '@nestjs/graphql';

// Lo que hace falta para mostrar una línea de pedido sin cruzarla con el catálogo: qué producto, en
// qué color y talla. Sale de la variante (y su producto, color y talla) que ya trae la consulta.
@ObjectType('InternalOrderItemVariant')
export class InternalOrderItemVariantObjectType {
  @Field()
  sku: string;

  @Field()
  productName: string;

  @Field()
  reference: string;

  @Field()
  colorName: string;

  @Field(() => String, { nullable: true })
  colorHex: string | null;

  @Field()
  sizeName: string;

  @Field(() => String, { nullable: true })
  imageUrl: string | null;
}
