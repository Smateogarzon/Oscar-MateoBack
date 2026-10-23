import { Decimal } from 'decimal.js';
import { Field, ID, ObjectType } from '@nestjs/graphql';

// Una línea de "qué pedir": un modelo de una tienda cuyo stock vendible quedó por debajo de su
// mínimo. Trae los nombres resueltos (como `stockOptions` en Pedidos) porque es una vista de solo
// lectura que se mira tal cual, sin cruzarla con el catálogo.
@ObjectType('StoreRestockSuggestion')
export class StoreRestockSuggestionObjectType {
  @Field(() => ID)
  locationId: string;

  @Field()
  locationName: string;

  @Field(() => ID)
  productId: string;

  @Field()
  productName: string;

  @Field()
  reference: string;

  @Field(() => ID)
  colorId: string;

  @Field()
  colorName: string;

  @Field(() => Decimal)
  minQuantity: Decimal;

  /** Lo que hay físicamente en la tienda de ese modelo, sumando sus tallas. */
  @Field(() => Decimal)
  quantity: Decimal;

  /** De eso, lo que se puede vender: lo que hay menos lo apartado y lo del cajón de devoluciones. */
  @Field(() => Decimal)
  available: Decimal;

  /** Lo que ya va en camino en traslados (TR/RS) todavía sin recibir: no hay que volver a pedirlo. */
  @Field(() => Decimal)
  incoming: Decimal;

  /** Lo que falta de verdad: el mínimo menos lo vendible menos lo que viene. Nunca negativo. */
  @Field(() => Decimal)
  missing: Decimal;
}
