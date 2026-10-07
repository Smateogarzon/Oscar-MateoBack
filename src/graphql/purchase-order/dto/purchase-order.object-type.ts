import { Decimal } from 'decimal.js';
import { Field, ID, ObjectType, registerEnumType } from '@nestjs/graphql';
import { BaseObjectType } from '../../../common/dto/base.object-type.js';
import { PurchaseOrderStatus } from '../entities/purchase-order-status.enum.js';

registerEnumType(PurchaseOrderStatus, {
  name: 'PurchaseOrderStatus',
  description: 'Estado de una orden de compra',
});

@ObjectType('PurchaseOrder')
export class PurchaseOrderObjectType extends BaseObjectType {
  @Field()
  companyId: string;

  @Field()
  supplierId: string;

  @Field()
  orderNumber: string;

  @Field()
  destinationLocationId: string;

  @Field(() => PurchaseOrderStatus)
  status: PurchaseOrderStatus;

  // Alguna línea quedó con novedad: la pantalla pinta la orden distinto aunque esté recibida.
  @Field()
  hasIncidents: boolean;

  @Field(() => Decimal)
  subtotal: Decimal;

  @Field(() => Decimal)
  total: Decimal;

  @Field(() => Date, { nullable: true })
  expectedAt: Date | null;

  @Field()
  createdBy: string;

  @Field(() => Date, { nullable: true })
  shippedAt: Date | null;

  @Field(() => Date, { nullable: true })
  receivedAt: Date | null;

  @Field(() => ID, { nullable: true })
  receivedBy: string | null;

  @Field(() => Date, { nullable: true })
  cancelledAt: Date | null;

  @Field(() => ID, { nullable: true })
  cancelledBy: string | null;

  @Field(() => String, { nullable: true })
  cancellationReason: string | null;
}
