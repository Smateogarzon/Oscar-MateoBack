import { Decimal } from 'decimal.js';
import { Field, ID, ObjectType } from '@nestjs/graphql';
import { BaseObjectType } from '../../../common/dto/base.object-type.js';

// Solo los ids: los nombres del modelo y de la tienda ya los tiene la pantalla de Inventario, que
// carga productos, colores y sedes para armar el listado.
@ObjectType('StoreModelMinimum')
export class StoreModelMinimumObjectType extends BaseObjectType {
  @Field(() => ID)
  locationId: string;

  @Field(() => ID)
  productId: string;

  @Field(() => ID)
  colorId: string;

  @Field(() => Decimal)
  minQuantity: Decimal;
}
