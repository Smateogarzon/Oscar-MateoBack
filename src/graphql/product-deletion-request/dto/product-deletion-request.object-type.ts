import { Field, ID, ObjectType, registerEnumType } from '@nestjs/graphql';
import { ProductDeletionRequestStatus } from '../entities/product-deletion-request-status.enum.js';

registerEnumType(ProductDeletionRequestStatus, {
  name: 'ProductDeletionRequestStatus',
  description: 'Estado de una solicitud de borrado de referencia: pendiente, aprobada, rechazada o cancelada',
});

// No extiende BaseObjectType: la solicitud lleva requestedAt y resolvedAt en vez de
// createdAt y updatedAt.
@ObjectType('ProductDeletionRequest')
export class ProductDeletionRequestObjectType {
  @Field(() => ID)
  id: string;

  @Field()
  productId: string;

  @Field()
  requestedBy: string;

  @Field(() => String, { nullable: true })
  resolvedBy: string | null;

  @Field(() => String, { nullable: true })
  reason: string | null;

  @Field(() => String, { nullable: true })
  resolutionNotes: string | null;

  @Field(() => ProductDeletionRequestStatus)
  status: ProductDeletionRequestStatus;

  @Field(() => Date)
  requestedAt: Date;

  @Field(() => Date, { nullable: true })
  resolvedAt: Date | null;
}
