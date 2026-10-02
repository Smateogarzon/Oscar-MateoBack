import { Column, Entity, Index, JoinColumn, ManyToOne } from 'typeorm';
import { BaseEntity } from '../../../common/entities/base.entity.js';
import { Company } from '../../company/entities/company.entity.js';
import { Location } from '../../location/entities/location.entity.js';
import { User } from '../../user/entities/user.entity.js';
import { InternalOrderOrigin } from './internal-order-origin.enum.js';
import { InternalOrderStatus } from './internal-order-status.enum.js';
import { InternalOrderType } from './internal-order-type.enum.js';

// Un pedido interno: bodega → corredor → destino (ver internal-order-status.enum.ts para el
// recorrido completo). `versionNumber` existe porque editar las líneas de un pedido que bodega ya
// aceptó no se hace en el sitio: se guarda como una fila nueva con el mismo `orderNumber` y la
// versión siguiente, dejando intacta la anterior (que queda CANCELLED); ver
// InternalOrderService.reviseItems. La "última" versión de un pedido es la de mayor
// `versionNumber` para ese `orderNumber`.
@Entity('internal_orders')
@Index(['companyId', 'orderNumber', 'versionNumber'], { unique: true })
@Index(['companyId', 'status'])
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

  @Column({ type: 'uuid', nullable: true })
  sourceLocationId: string | null;

  @ManyToOne(() => Location, { nullable: true })
  @JoinColumn({ name: 'sourceLocationId' })
  sourceLocation: Location | null;

  @Column({ type: 'uuid', nullable: true })
  destinationLocationId: string | null;

  @ManyToOne(() => Location, { nullable: true })
  @JoinColumn({ name: 'destinationLocationId' })
  destinationLocation: Location | null;

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
  @Column({
    type: 'enum',
    enum: InternalOrderStatus,
    enumName: 'internal_order_status',
    default: InternalOrderStatus.PENDING,
  })
  status: InternalOrderStatus;

  @Column({ type: 'timestamptz', nullable: true })
  warehouseAcceptedAt: Date | null;

  @Column({ type: 'timestamptz', nullable: true })
  packingStartedAt: Date | null;

  @Column({ type: 'timestamptz', nullable: true })
  readyAt: Date | null;

  @Column({ type: 'timestamptz', nullable: true })
  runnerAcceptedAt: Date | null;

  @Column({ type: 'timestamptz', nullable: true })
  runnerPickedUpAt: Date | null;

  @Column({ type: 'timestamptz', nullable: true })
  deliveredAt: Date | null;

  @Column({ type: 'timestamptz', nullable: true })
  receivedAt: Date | null;

  @Column({ type: 'timestamptz', nullable: true })
  completedAt: Date | null;

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
