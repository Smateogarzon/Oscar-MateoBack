import { Column, Entity, Index, JoinColumn, ManyToOne } from 'typeorm';
import { BaseEntity } from '../../../common/entities/base.entity.js';
import { Incident } from '../../incident/entities/incident.entity.js';
import { User } from '../../user/entities/user.entity.js';
import { InternalOrder } from './internal-order.entity.js';

// "Retorno a bodega por error": llegó a la tienda una referencia equivocada. La orden no cambia de
// estado ni de versión; el corredor corrige en tres paradas (`step`):
//   0  recoge lo equivocado en la tienda y sale hacia bodega
//   1  llegó a bodega: se devuelve lo equivocado y se alista lo correcto
//   2  salió de bodega con lo correcto
//   3  el vendedor recibió lo correcto: corrección cerrada (closedAt)
// No mueve inventario: el sistema ya registró la variante correcta; lo que se corrige es el error
// físico de alistamiento, que queda como novedad (WRONG_VARIANT) para revisarlo después.
@Entity('internal_order_corrections')
@Index(['internalOrderId'])
export class InternalOrderCorrection extends BaseEntity {
  @Column({ type: 'uuid' })
  internalOrderId: string;

  @ManyToOne(() => InternalOrder, { nullable: false })
  @JoinColumn({ name: 'internalOrderId' })
  internalOrder: InternalOrder;

  @Column({ type: 'int' })
  versionNumber: number;

  @Column({ type: 'varchar', length: 500 })
  description: string;

  @Column({ type: 'uuid' })
  reportedBy: string;

  @ManyToOne(() => User, { nullable: false })
  @JoinColumn({ name: 'reportedBy' })
  reportedByUser: User;

  @Column({ type: 'uuid', nullable: true })
  runnerId: string | null;

  @ManyToOne(() => User, { nullable: true })
  @JoinColumn({ name: 'runnerId' })
  runner: User | null;

  @Column({ type: 'int', default: 0 })
  step: number;

  @Column({ type: 'timestamptz', nullable: true })
  arrivedAtWarehouseAt: Date | null;

  @Column({ type: 'timestamptz', nullable: true })
  leftWarehouseAt: Date | null;

  @Column({ type: 'timestamptz', nullable: true })
  closedAt: Date | null;

  @Column({ type: 'uuid', nullable: true })
  incidentId: string | null;

  @ManyToOne(() => Incident, { nullable: true })
  @JoinColumn({ name: 'incidentId' })
  incident: Incident | null;
}
