import { Field, ID, InputType } from '@nestjs/graphql';
import { IsString, IsUUID, MaxLength } from 'class-validator';
import { Trim } from '../../../common/decorators/trim.decorator.js';

// Dónde quedó una referencia en la sede que la recibe ("Rack A-14 · Nivel 2"). Es opcional y por
// línea: quien recibe escribe solo las que quiere ubicar, y las demás conservan la posición que ya
// tenían ahí. Se guarda en la existencia de esa sede, en el mismo movimiento que mete la mercancía
// (ver InternalOrderStock.fromRunner).
@InputType()
export class InternalOrderLinePositionInput {
  @Field(() => ID)
  @IsUUID()
  productVariantId: string;

  @Field()
  @Trim()
  @IsString()
  @MaxLength(120)
  position: string;
}
