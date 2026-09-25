import { Column, Entity, Index, JoinColumn, ManyToOne } from 'typeorm';
import { BaseEntity } from '../../../common/entities/base.entity.js';
import { RecordStatus } from '../../../common/enums/record-status.enum.js';
import { Location } from '../../location/entities/location.entity.js';

// Caja física de una tienda. Su código no se repite dentro de la tienda. La empresa de una caja es
// la de su tienda.
@Entity('cash_registers')
@Index(['storeId', 'code'], { unique: true })
export class CashRegister extends BaseEntity {
  @Index()
  @Column({ type: 'uuid' })
  storeId: string;

  @ManyToOne(() => Location, { nullable: false })
  @JoinColumn({ name: 'storeId' })
  store: Location;

  @Column({ type: 'varchar', length: 80 })
  name: string;

  @Column({ type: 'varchar', length: 30 })
  code: string;

  @Column({
    type: 'enum',
    enum: RecordStatus,
    enumName: 'record_status',
    default: RecordStatus.ACTIVE,
  })
  status: RecordStatus;
}
