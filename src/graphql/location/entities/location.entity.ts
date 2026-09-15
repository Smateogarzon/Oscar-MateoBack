import { Column, Entity, Index, JoinColumn, ManyToOne } from 'typeorm';
import { BaseEntity } from '../../../common/entities/base.entity.js';
import { RecordStatus } from '../../../common/enums/record-status.enum.js';
import { Company } from '../../company/entities/company.entity.js';
import { LocationType } from './location-type.enum.js';

// Sede física de una empresa: tienda o bodega
@Entity('locations')
@Index(['companyId', 'type'])
export class Location extends BaseEntity {
  // Empresa dueña de esta sede
  @Index()
  @Column({ type: 'uuid' })
  companyId: string;

  @ManyToOne(() => Company, { nullable: false })
  @JoinColumn({ name: 'companyId' })
  company: Company;

  @Column({ type: 'varchar', length: 120 })
  name: string;

  // STORE (punto de venta) o WAREHOUSE (bodega)
  @Column({ type: 'enum', enum: LocationType, enumName: 'location_type' })
  type: LocationType;

  @Column({ type: 'varchar', length: 255, nullable: true })
  address: string | null;

  @Column({ type: 'varchar', length: 100, nullable: true })
  city: string | null;

  @Column({ type: 'varchar', length: 30, nullable: true })
  phone: string | null;

  @Column({ type: 'varchar', length: 150, nullable: true })
  email: string | null;

  @Column({
    type: 'enum',
    enum: RecordStatus,
    enumName: 'record_status',
    default: RecordStatus.ACTIVE,
  })
  status: RecordStatus;
}
