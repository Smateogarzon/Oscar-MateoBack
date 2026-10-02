import { Field, ID, ObjectType, registerEnumType } from '@nestjs/graphql';
import { BaseObjectType } from '../../../common/dto/base.object-type.js';
import { InternalOrderOrigin } from '../entities/internal-order-origin.enum.js';
import { InternalOrderStatus } from '../entities/internal-order-status.enum.js';
import { InternalOrderType } from '../entities/internal-order-type.enum.js';

registerEnumType(InternalOrderType, { name: 'InternalOrderType', description: 'Para qué es el pedido interno' });
registerEnumType(InternalOrderOrigin, { name: 'InternalOrderOrigin', description: 'De dónde se originó el pedido' });
registerEnumType(InternalOrderStatus, { name: 'InternalOrderStatus', description: 'En qué punto va el pedido' });

@ObjectType('InternalOrder')
export class InternalOrderObjectType extends BaseObjectType {
  @Field()
  companyId: string;

  @Field()
  orderNumber: string;

  @Field()
  versionNumber: number;

  @Field(() => InternalOrderType)
  type: InternalOrderType;

  @Field(() => InternalOrderOrigin)
  origin: InternalOrderOrigin;

  @Field(() => ID, { nullable: true })
  sourceLocationId: string | null;

  @Field(() => ID, { nullable: true })
  destinationLocationId: string | null;

  @Field(() => ID, { nullable: true })
  requestedBy: string | null;

  @Field(() => ID, { nullable: true })
  warehouseOperatorId: string | null;

  @Field(() => ID, { nullable: true })
  runnerId: string | null;

  @Field(() => ID, { nullable: true })
  receivedBy: string | null;

  @Field(() => InternalOrderStatus)
  status: InternalOrderStatus;

  @Field(() => Date, { nullable: true })
  warehouseAcceptedAt: Date | null;

  @Field(() => Date, { nullable: true })
  packingStartedAt: Date | null;

  @Field(() => Date, { nullable: true })
  readyAt: Date | null;

  @Field(() => Date, { nullable: true })
  runnerAcceptedAt: Date | null;

  @Field(() => Date, { nullable: true })
  runnerPickedUpAt: Date | null;

  @Field(() => Date, { nullable: true })
  deliveredAt: Date | null;

  @Field(() => Date, { nullable: true })
  receivedAt: Date | null;

  @Field(() => Date, { nullable: true })
  completedAt: Date | null;

  @Field(() => String, { nullable: true })
  notes: string | null;

  @Field(() => Date, { nullable: true })
  cancelledAt: Date | null;

  @Field(() => ID, { nullable: true })
  cancelledBy: string | null;

  @Field(() => String, { nullable: true })
  cancellationReason: string | null;
}
