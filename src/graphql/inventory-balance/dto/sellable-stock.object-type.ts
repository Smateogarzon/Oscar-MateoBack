import { Decimal } from 'decimal.js';
import { Field, ID, ObjectType } from '@nestjs/graphql';

// Lo que se puede vender de una variante ahora mismo (ver InventoryBalanceService.findSellableStock).
// Las variantes sin nada disponible no vienen: para quien lo lee, que no esté es que no hay.
@ObjectType('SellableStock')
export class SellableStockObjectType {
  @Field(() => ID)
  productVariantId: string;

  @Field(() => Decimal)
  availableQuantity: Decimal;
}
