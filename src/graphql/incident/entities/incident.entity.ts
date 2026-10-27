import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { Company } from '../../company/entities/company.entity.js';
import { Location } from '../../location/entities/location.entity.js';
import { ProductVariant } from '../../product-variant/entities/product-variant.entity.js';
import { User } from '../../user/entities/user.entity.js';
import { IncidentStatus } from './incident-status.enum.js';
import { IncidentType } from './incident-type.enum.js';

// Una novedad: transversal a toda la operación, no solo a inventario (el "tipo" ya trae valores de
// módulos que todavía no existen — pedidos, corredores, proveedores — para no migrar la columna
// después). Se reporta, y de ahí en más solo cambia su estado (OPEN → IN_REVIEW → RESUELTA o
// CANCELADA); nunca se borra. No extiende BaseEntity: no tiene updatedAt (ver resolvedAt).
@Entity('incidents')
@Index(['companyId', 'type'])
@Index(['companyId', 'status'])
@Index(['entityType', 'entityId'])
export class Incident {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Index()
  @Column({ type: 'uuid' })
  companyId: string;

  @ManyToOne(() => Company, { nullable: false })
  @JoinColumn({ name: 'companyId' })
  company: Company;

  @Column({ type: 'enum', enum: IncidentType, enumName: 'incident_type' })
  type: IncidentType;

  @Column({
    type: 'enum',
    enum: IncidentStatus,
    enumName: 'incident_status',
    default: IncidentStatus.OPEN,
  })
  status: IncidentStatus;

  @Column({ type: 'varchar', length: 150 })
  title: string;

  @Column({ type: 'varchar', length: 500, nullable: true })
  description: string | null;

  // A qué se refiere (una venta, una variante, un movimiento, ...), igual que en notifications.
  @Column({ type: 'varchar', length: 60, nullable: true })
  entityType: string | null;

  @Column({ type: 'uuid', nullable: true })
  entityId: string | null;

  @Index()
  @Column({ type: 'uuid', nullable: true })
  locationId: string | null;

  @ManyToOne(() => Location, { nullable: true })
  @JoinColumn({ name: 'locationId' })
  location: Location | null;

  @Column({ type: 'uuid', nullable: true })
  productVariantId: string | null;

  @ManyToOne(() => ProductVariant, { nullable: true })
  @JoinColumn({ name: 'productVariantId' })
  productVariant: ProductVariant | null;

  @Column({ type: 'uuid' })
  reportedBy: string;

  @ManyToOne(() => User, { nullable: false })
  @JoinColumn({ name: 'reportedBy' })
  reportedByUser: User;

  @Column({ type: 'uuid', nullable: true })
  resolvedBy: string | null;

  @ManyToOne(() => User, { nullable: true })
  @JoinColumn({ name: 'resolvedBy' })
  resolvedByUser: User | null;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt: Date;

  @Column({ type: 'timestamptz', nullable: true })
  resolvedAt: Date | null;
}
