import { Field, ID, Int, ObjectType, registerEnumType } from '@nestjs/graphql';
import { BaseObjectType } from '../../../common/dto/base.object-type.js';
import { InternalOrderEventKind } from '../entities/internal-order-event-kind.enum.js';
import { InternalOrderNudge } from '../entities/internal-order-nudge.enum.js';
import { InternalOrderOrigin } from '../entities/internal-order-origin.enum.js';
import { InternalOrderPriority } from '../entities/internal-order-priority.enum.js';
import { InternalOrderStatus } from '../entities/internal-order-status.enum.js';
import { InternalOrderType } from '../entities/internal-order-type.enum.js';
import { InternalOrderItemObjectType } from './internal-order-item.object-type.js';

registerEnumType(InternalOrderType, { name: 'InternalOrderType', description: 'SO venta, RE devolución, TR traslado, RS surtido' });
registerEnumType(InternalOrderOrigin, { name: 'InternalOrderOrigin', description: 'De dónde se originó la orden' });
registerEnumType(InternalOrderStatus, { name: 'InternalOrderStatus', description: 'En qué punto de su flujo va la orden' });
registerEnumType(InternalOrderPriority, { name: 'InternalOrderPriority', description: 'HIGH: el cliente espera en el piso' });
registerEnumType(InternalOrderEventKind, { name: 'InternalOrderEventKind', description: 'Qué registra una fila de la bitácora' });
registerEnumType(InternalOrderNudge, { name: 'InternalOrderNudge', description: 'Lo que el vendedor le pide a otro sin cambiar la orden' });

// Las líneas, los nombres, la bitácora, las correcciones y las órdenes ligadas los resuelve
// InternalOrderResolver (en las listas ya vienen cargados).
@ObjectType('InternalOrder')
export class InternalOrderObjectType extends BaseObjectType {
  @Field()
  companyId: string;

  @Field()
  orderNumber: string;

  @Field(() => Int)
  versionNumber: number;

  @Field(() => InternalOrderType)
  type: InternalOrderType;

  @Field(() => InternalOrderOrigin)
  origin: InternalOrderOrigin;

  @Field(() => InternalOrderPriority)
  priority: InternalOrderPriority;

  @Field(() => InternalOrderStatus)
  status: InternalOrderStatus;

  @Field(() => Date)
  statusChangedAt: Date;

  @Field(() => ID)
  sourceLocationId: string;

  @Field(() => ID)
  destinationLocationId: string;

  @Field(() => String, { nullable: true })
  deliveryPoint: string | null;

  @Field(() => ID, { nullable: true })
  requestedBy: string | null;

  @Field(() => ID, { nullable: true })
  warehouseOperatorId: string | null;

  @Field(() => ID, { nullable: true })
  runnerId: string | null;

  @Field(() => ID, { nullable: true })
  receivedBy: string | null;

  @Field(() => ID, { nullable: true })
  parentOrderId: string | null;

  @Field(() => ID, { nullable: true })
  relatedOrderId: string | null;

  @Field(() => ID, { nullable: true })
  saleId: string | null;

  @Field(() => String, { nullable: true })
  notes: string | null;

  @Field(() => Date, { nullable: true })
  cancelledAt: Date | null;

  @Field(() => ID, { nullable: true })
  cancelledBy: string | null;

  @Field(() => String, { nullable: true })
  cancellationReason: string | null;
}

// Un paso de la bitácora: qué pasó, cuándo (createdAt), dónde y quién.
@ObjectType('InternalOrderEvent')
export class InternalOrderEventObjectType {
  @Field(() => ID)
  id: string;

  @Field(() => Date)
  createdAt: Date;

  @Field(() => Int)
  versionNumber: number;

  @Field(() => InternalOrderEventKind)
  kind: InternalOrderEventKind;

  @Field(() => InternalOrderStatus, { nullable: true })
  fromStatus: InternalOrderStatus | null;

  @Field(() => InternalOrderStatus, { nullable: true })
  toStatus: InternalOrderStatus | null;

  @Field(() => ID, { nullable: true })
  locationId: string | null;

  @Field(() => String, { nullable: true })
  locationName: string | null;

  @Field(() => ID, { nullable: true })
  actorId: string | null;

  @Field(() => String, { nullable: true })
  actorName: string | null;

  @Field()
  detail: string;
}

// El retorno a bodega por error de una orden (ver la entidad): en qué parada va.
@ObjectType('InternalOrderCorrection')
export class InternalOrderCorrectionObjectType {
  @Field(() => ID)
  id: string;

  @Field(() => Date)
  createdAt: Date;

  @Field(() => Int)
  versionNumber: number;

  @Field()
  description: string;

  @Field(() => String, { nullable: true })
  reportedByName: string | null;

  @Field(() => String, { nullable: true })
  runnerName: string | null;

  @Field(() => Int)
  step: number;

  @Field(() => Date, { nullable: true })
  arrivedAtWarehouseAt: Date | null;

  @Field(() => Date, { nullable: true })
  leftWarehouseAt: Date | null;

  @Field(() => Date, { nullable: true })
  closedAt: Date | null;

  @Field(() => ID, { nullable: true })
  incidentId: string | null;
}

// Una versión de la orden: por qué nació, quién, desde qué bodega, y sus líneas (las resuelve el
// resolver de versiones).
@ObjectType('InternalOrderVersion')
export class InternalOrderVersionObjectType {
  @Field(() => ID)
  id: string;

  @Field(() => Date)
  createdAt: Date;

  @Field(() => Int)
  versionNumber: number;

  @Field()
  reason: string;

  @Field(() => String, { nullable: true })
  createdByName: string | null;

  @Field(() => ID)
  sourceLocationId: string;

  @Field(() => String, { nullable: true })
  sourceLocationName: string | null;

  @Field(() => [InternalOrderItemObjectType])
  items: InternalOrderItemObjectType[];
}

// Cuánto hay disponible de una variante en una sede (para pedir o cambiar).
@ObjectType('OrderStockOption')
export class OrderStockOptionObjectType {
  @Field(() => ID)
  productVariantId: string;

  @Field(() => ID)
  locationId: string;

  @Field()
  locationName: string;

  @Field()
  locationType: string;

  @Field()
  available: string;
}
