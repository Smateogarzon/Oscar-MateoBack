import { Column, Entity, Index, JoinColumn, ManyToOne } from 'typeorm';
import { BaseEntity } from '../../../common/entities/base.entity.js';
import { Company } from '../../company/entities/company.entity.js';
import { Location } from '../../location/entities/location.entity.js';
import { User } from '../../user/entities/user.entity.js';
import { InternalOrderOrigin } from './internal-order-origin.enum.js';
import { InternalOrderPriority } from './internal-order-priority.enum.js';
import { InternalOrderStatus } from './internal-order-status.enum.js';
import { InternalOrderType } from './internal-order-type.enum.js';

// Una orden interna (SO, RE, TR o RS; ver internal-order-type.enum.ts). La fila es estable: su id
// no cambia nunca, aunque la orden pase por varias versiones. Una versión nueva (cambio de pedido,
// devolución, unión de una sub-orden) sube `versionNumber`, guarda su motivo en
// internal_order_versions y deja sus líneas aparte (InternalOrderItem.versionNumber): la anterior
// queda intacta como histórico.
//
// Cada cambio de estado deja una fila en internal_order_events con su fecha y hora: de ahí salen la
// bitácora, el recorrido por ubicación y los tiempos operativos. `statusChangedAt` es solo el atajo
// para "cuánto lleva en el estado actual".
//
// Relaciones entre órdenes (trazabilidad):
//   parentOrderId   la SO de la que esta es sub-orden (un cambio de pedido que despacha otra bodega)
//   relatedOrderId  la RE de una SO que se devuelve, y en la RE, la SO de la que nace
//   saleId          la venta con que se cobró la SO (sales.internalOrderId apunta de vuelta)
@Entity('internal_orders')
@Index(['companyId', 'orderNumber'], { unique: true })
@Index(['companyId', 'status'])
@Index(['companyId', 'type'])
export class InternalOrder extends BaseEntity {
  @Index()
  @Column({ type: 'uuid' })
  companyId: string;

  @ManyToOne(() => Company, { nullable: false })
  @JoinColumn({ name: 'companyId' })
  company: Company;

  @Column({ type: 'varchar', length: 50 })
  orderNumber: string;

  @Column({ type: 'int', default: 1 })
  versionNumber: number;

  @Column({ type: 'enum', enum: InternalOrderType, enumName: 'internal_order_type' })
  type: InternalOrderType;

  @Column({ type: 'enum', enum: InternalOrderOrigin, enumName: 'internal_order_origin' })
  origin: InternalOrderOrigin;

  @Column({
    type: 'enum',
    enum: InternalOrderPriority,
    enumName: 'internal_order_priority',
    default: InternalOrderPriority.NORMAL,
  })
  priority: InternalOrderPriority;

  @Index()
  @Column({ type: 'enum', enum: InternalOrderStatus, enumName: 'internal_order_status' })
  status: InternalOrderStatus;

  @Column({ type: 'timestamptz' })
  statusChangedAt: Date;

  // De dónde sale la mercancía y a dónde llega (sedes, no cajones de inventario).
  @Column({ type: 'uuid' })
  sourceLocationId: string;

  @ManyToOne(() => Location, { nullable: false })
  @JoinColumn({ name: 'sourceLocationId' })
  sourceLocation: Location;

  @Column({ type: 'uuid' })
  destinationLocationId: string;

  @ManyToOne(() => Location, { nullable: false })
  @JoinColumn({ name: 'destinationLocationId' })
  destinationLocation: Location;

  // Dónde, dentro del destino, lo entrega el corredor ("Probador #02", "Mostrador POS").
  @Column({ type: 'varchar', length: 80, nullable: true })
  deliveryPoint: string | null;

  @Column({ type: 'uuid', nullable: true })
  requestedBy: string | null;

  @ManyToOne(() => User, { nullable: true })
  @JoinColumn({ name: 'requestedBy' })
  requestedByUser: User | null;

  @Column({ type: 'uuid', nullable: true })
  warehouseOperatorId: string | null;

  @ManyToOne(() => User, { nullable: true })
  @JoinColumn({ name: 'warehouseOperatorId' })
  warehouseOperator: User | null;

  @Index()
  @Column({ type: 'uuid', nullable: true })
  runnerId: string | null;

  @ManyToOne(() => User, { nullable: true })
  @JoinColumn({ name: 'runnerId' })
  runner: User | null;

  @Column({ type: 'uuid', nullable: true })
  receivedBy: string | null;

  @ManyToOne(() => User, { nullable: true })
  @JoinColumn({ name: 'receivedBy' })
  receivedByUser: User | null;

  @Index()
  @Column({ type: 'uuid', nullable: true })
  parentOrderId: string | null;

  @ManyToOne(() => InternalOrder, { nullable: true })
  @JoinColumn({ name: 'parentOrderId' })
  parentOrder: InternalOrder | null;

  @Index()
  @Column({ type: 'uuid', nullable: true })
  relatedOrderId: string | null;

  @ManyToOne(() => InternalOrder, { nullable: true })
  @JoinColumn({ name: 'relatedOrderId' })
  relatedOrder: InternalOrder | null;

  // Sin relación a Sale a propósito (la FK está en la migración): Sale ya guarda internalOrderId, y
  // una relación en los dos sentidos ataría los dos módulos.
  @Column({ type: 'uuid', nullable: true })
  saleId: string | null;

  @Column({ type: 'varchar', length: 500, nullable: true })
  notes: string | null;

  @Column({ type: 'timestamptz', nullable: true })
  cancelledAt: Date | null;

  @Column({ type: 'uuid', nullable: true })
  cancelledBy: string | null;

  @ManyToOne(() => User, { nullable: true })
  @JoinColumn({ name: 'cancelledBy' })
  cancelledByUser: User | null;

  @Column({ type: 'varchar', length: 255, nullable: true })
  cancellationReason: string | null;
}
