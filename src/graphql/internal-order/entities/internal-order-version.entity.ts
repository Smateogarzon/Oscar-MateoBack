import { Column, Entity, Index, JoinColumn, ManyToOne } from 'typeorm';
import { ImmutableEntity } from '../../../common/entities/immutable.entity.js';
import { Location } from '../../location/entities/location.entity.js';
import { User } from '../../user/entities/user.entity.js';
import { InternalOrder } from './internal-order.entity.js';

// Una versión de una orden: por qué nació (la 1 es la creación) y desde qué bodega salía su
// mercancía en ese momento. Sus líneas son las InternalOrderItem con este mismo versionNumber, y su
// recorrido, los eventos con este versionNumber. Nunca se edita: la versión siguiente es otra fila.
@Entity('internal_order_versions')
@Index(['internalOrderId', 'versionNumber'], { unique: true })
export class InternalOrderVersion extends ImmutableEntity {
  @Column({ type: 'uuid' })
  internalOrderId: string;

  @ManyToOne(() => InternalOrder, { nullable: false })
  @JoinColumn({ name: 'internalOrderId' })
  internalOrder: InternalOrder;

  @Column({ type: 'int' })
  versionNumber: number;

  @Column({ type: 'varchar', length: 255 })
  reason: string;

  @Column({ type: 'uuid', nullable: true })
  createdBy: string | null;

  @ManyToOne(() => User, { nullable: true })
  @JoinColumn({ name: 'createdBy' })
  createdByUser: User | null;

  @Column({ type: 'uuid' })
  sourceLocationId: string;

  @ManyToOne(() => Location, { nullable: false })
  @JoinColumn({ name: 'sourceLocationId' })
  sourceLocation: Location;
}
