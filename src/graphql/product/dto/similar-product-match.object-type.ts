import { Field, Float, ID, ObjectType } from '@nestjs/graphql';

// Un candidato a "quisiste decir esto" (ver ProductService.findSimilarByName): no es un
// Product completo, solo lo que el front necesita para mostrar la sugerencia.
@ObjectType('SimilarProductMatch')
export class SimilarProductMatchObjectType {
  @Field(() => ID)
  id: string;

  @Field()
  name: string;

  @Field()
  reference: string;

  // Similitud de trigramas entre 0 y 1 (ver NAME_SIMILARITY_THRESHOLD en product.service.ts).
  @Field(() => Float)
  score: number;
}
