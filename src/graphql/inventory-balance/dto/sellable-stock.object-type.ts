import { Decimal } from 'decimal.js';
import { Field, ID, ObjectType } from '@nestjs/graphql';

// Qué se puede hacer con una variante ahora mismo, desde la tienda que vende (ver
// InventoryBalanceService.findSellableStock). Las variantes sin nada en ningún lado no vienen: para
// quien lo lee, que no esté es que no hay.
@ObjectType('SellableStock')
export class SellableStockObjectType {
  @Field(() => ID)
  productVariantId: string;

  /** Lo que se puede COBRAR ya: lo disponible en el cajón de la tienda que vende. */
  @Field(() => Decimal)
  availableQuantity: Decimal;

  /** Lo que se puede PEDIR: lo disponible en la bodega que más tenga. No se cobra sin pedirlo. */
  @Field(() => Decimal)
  warehouseQuantity: Decimal;
}
