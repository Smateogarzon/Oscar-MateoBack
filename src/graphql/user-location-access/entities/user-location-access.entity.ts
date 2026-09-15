import { Column, Entity, Index, JoinColumn, ManyToOne } from 'typeorm';
import { ImmutableEntity } from '../../../common/entities/immutable.entity.js';
import { RecordStatus } from '../../../common/enums/record-status.enum.js';
import { Location } from '../../location/entities/location.entity.js';
import { User } from '../../user/entities/user.entity.js';

// A qué sedes tiene acceso un usuario
@Entity('user_location_access')
@Index(['userId', 'locationId'], { unique: true })
export class UserLocationAccess extends ImmutableEntity {
  @Column({ type: 'uuid' })
  userId: string;

  @ManyToOne(() => User, { nullable: false })
  @JoinColumn({ name: 'userId' })
  user: User;

  @Column({ type: 'uuid' })
  locationId: string;

  @ManyToOne(() => Location, { nullable: false })
  @JoinColumn({ name: 'locationId' })
  location: Location;

  @Column({
    type: 'enum',
    enum: RecordStatus,
    enumName: 'record_status',
    default: RecordStatus.ACTIVE,
  })
  status: RecordStatus;
}
