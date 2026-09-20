import { Decimal } from 'decimal.js';
import { Field, ID, ObjectType, registerEnumType } from '@nestjs/graphql';
import { DiscountRequestStatus } from '../entities/discount-request-status.enum.js';

registerEnumType(DiscountRequestStatus, {
  name: 'DiscountRequestStatus',
  description: 'Estado de una solicitud de descuento: pendiente, aprobada, rechazada o cancelada',
});

// No extiende BaseObjectType: la solicitud lleva requestedAt y resolvedAt en vez de
// createdAt y updatedAt.
@ObjectType('DiscountRequest')
export class DiscountRequestObjectType {
  @Field(() => ID)
  id: string;

  @Field()
  saleId: string;

  @Field()
  requestedBy: string;

  @Field(() => String, { nullable: true })
  resolvedBy: string | null;

  // Total que se pide: el monto único, o la suma de los de las líneas (ver discountRequestItems)
  @Field(() => Decimal)
  requestedDiscount: Decimal;

  // Total aprobado; vacío mientras no se aprueba
  @Field(() => Decimal, { nullable: true })
  approvedDiscount: Decimal | null;

  @Field(() => String, { nullable: true })
  reason: string | null;

  @Field(() => String, { nullable: true })
  resolutionNotes: string | null;

  @Field(() => DiscountRequestStatus)
  status: DiscountRequestStatus;

  @Field(() => Date)
  requestedAt: Date;

  @Field(() => Date, { nullable: true })
  resolvedAt: Date | null;
}
