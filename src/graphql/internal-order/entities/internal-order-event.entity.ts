import { Column, Entity, Index, JoinColumn, ManyToOne } from 'typeorm';
import { ImmutableEntity } from '../../../common/entities/immutable.entity.js';
import { Location } from '../../location/entities/location.entity.js';
import { User } from '../../user/entities/user.entity.js';
import { InternalOrderEventKind } from './internal-order-event-kind.enum.js';
import { InternalOrderStatus } from './internal-order-status.enum.js';
import { InternalOrder } from './internal-order.entity.js';

// La bitácora auditable de una orden: una fila por cada cosa que le pasó, con su fecha y hora
// (createdAt), quién la hizo, en qué versión y dónde (`locationId`: la sede en que ocurrió). Nunca se
// edita ni se borra. De aquí salen los tiempos operativos (hasta aceptación, de alistamiento,
// esperando corredor, de transporte, hasta recepción, total) y el recorrido por ubicación.
@Entity('internal_order_events')
@Index(['internalOrderId', 'createdAt'])
export class InternalOrderEvent extends ImmutableEntity {
  @Column({ type: 'uuid' })
  internalOrderId: string;

  @ManyToOne(() => InternalOrder, { nullable: false })
  @JoinColumn({ name: 'internalOrderId' })
  internalOrder: InternalOrder;

  @Column({ type: 'int' })
  versionNumber: number;

  @Column({ type: 'enum', enum: InternalOrderEventKind, enumName: 'internal_order_event_kind' })
  kind: InternalOrderEventKind;

  @Column({ type: 'enum', enum: InternalOrderStatus, enumName: 'internal_order_status', nullable: true })
  fromStatus: InternalOrderStatus | null;

  @Column({ type: 'enum', enum: InternalOrderStatus, enumName: 'internal_order_status', nullable: true })
  toStatus: InternalOrderStatus | null;

  @Column({ type: 'uuid', nullable: true })
  locationId: string | null;

  @ManyToOne(() => Location, { nullable: true })
  @JoinColumn({ name: 'locationId' })
  location: Location | null;

  @Column({ type: 'uuid', nullable: true })
  actorId: string | null;

  @ManyToOne(() => User, { nullable: true })
  @JoinColumn({ name: 'actorId' })
  actor: User | null;

  @Column({ type: 'varchar', length: 500 })
  detail: string;
}
