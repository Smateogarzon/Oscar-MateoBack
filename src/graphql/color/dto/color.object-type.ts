import { Field, ObjectType } from '@nestjs/graphql';
import { ImmutableObjectType } from '../../../common/dto/immutable.object-type.js';

@ObjectType('Color')
export class ColorObjectType extends ImmutableObjectType {
  @Field()
  name: string;

  @Field(() => String, { nullable: true })
  hex: string | null;

  // El segundo tono de un color combinado ("Blanco negro"): con este puesto, el selector pinta el
  // punto mitad y mitad en vez de un solo círculo.
  @Field(() => String, { nullable: true })
  secondHex: string | null;
}
