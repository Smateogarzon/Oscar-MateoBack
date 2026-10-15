import { Decimal } from 'decimal.js';
import { Field, ID, ObjectType } from '@nestjs/graphql';
import { BaseObjectType } from '../../../common/dto/base.object-type.js';

@ObjectType('PurchaseOrderItem')
export class PurchaseOrderItemObjectType extends BaseObjectType {
  @Field()
  purchaseOrderId: string;

  @Field()
  productVariantId: string;

  @Field(() => Decimal)
  quantity: Decimal;

  // Null mientras nadie la haya contado todavía: el proveedor al despachar, bodega al recibir.
  @Field(() => Decimal, { nullable: true })
  shippedQuantity: Decimal | null;

  @Field(() => Decimal, { nullable: true })
  receivedQuantity: Decimal | null;

  // Las novedades de la línea, si las hubo (ver purchase-order-incidents.ts).
  @Field(() => ID, { nullable: true })
  shipmentIncidentId: string | null;

  @Field(() => ID, { nullable: true })
  receptionIncidentId: string | null;

  @Field(() => Decimal)
  unitCost: Decimal;
}
