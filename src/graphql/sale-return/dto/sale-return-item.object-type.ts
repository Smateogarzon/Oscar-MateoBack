import { Decimal } from 'decimal.js';
import { Field, ObjectType } from '@nestjs/graphql';
import { ImmutableObjectType } from '../../../common/dto/immutable.object-type.js';

@ObjectType('SaleReturnItem')
export class SaleReturnItemObjectType extends ImmutableObjectType {
  @Field()
  saleReturnId: string;

  // La línea de la venta original
  @Field()
  saleItemId: string;

  @Field(() => Decimal)
  quantity: Decimal;

  // Lo que el cliente realmente pagó por esas unidades
  @Field(() => Decimal)
  amount: Decimal;
}
