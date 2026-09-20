import { Decimal } from 'decimal.js';
import { Field, ObjectType, registerEnumType } from '@nestjs/graphql';
import { BaseObjectType } from '../../../common/dto/base.object-type.js';
import { SaleItemType } from '../entities/sale-item-type.enum.js';

registerEnumType(SaleItemType, {
  name: 'SaleItemType',
  description: 'Tipo de línea de venta: de inventario o genérica',
});

@ObjectType('SaleItem')
export class SaleItemObjectType extends BaseObjectType {
  @Field()
  saleId: string;

  @Field(() => SaleItemType)
  type: SaleItemType;

  @Field(() => String, { nullable: true })
  productVariantId: string | null;

  @Field()
  description: string;

  @Field(() => String, { nullable: true })
  sku: string | null;

  @Field(() => Decimal)
  quantity: Decimal;

  @Field(() => Decimal)
  unitPrice: Decimal;

  @Field(() => Decimal)
  discountAmount: Decimal;

  // cantidad × precio unitario − descuento de la línea
  @Field(() => Decimal)
  total: Decimal;
}
