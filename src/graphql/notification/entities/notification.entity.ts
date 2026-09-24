import { Column, Entity, Index, JoinColumn, ManyToOne } from 'typeorm';
import { ImmutableEntity } from '../../../common/entities/immutable.entity.js';
import { Company } from '../../company/entities/company.entity.js';
import { Location } from '../../location/entities/location.entity.js';
import { User } from '../../user/entities/user.entity.js';
import { NotificationChannel } from './notification-channel.enum.js';
import { NotificationEntityType } from './notification-entity-type.enum.js';
import { NotificationType } from './notification-type.enum.js';

// Un aviso: su contenido va una sola vez aquí; quién lo recibe y si lo leyó vive en
// user_notifications. Solo se crea. No guarda el estado de lo que avisa (ese sigue en su tabla, por
// ejemplo discount_requests): apunta a ello con entityType + entityId. La empresa es la de la
// venta o la devolución que lo originó.
@Entity('notifications')
@Index(['entityType', 'entityId'])
export class Notification extends ImmutableEntity {
  @Index()
  @Column({ type: 'uuid' })
  companyId: string;

  @ManyToOne(() => Company, { nullable: false })
  @JoinColumn({ name: 'companyId' })
  company: Company;

  @Column({ type: 'varchar', length: 30 })
  channel: NotificationChannel;

  @Column({ type: 'varchar', length: 60 })
  type: NotificationType;

  @Column({ type: 'varchar', length: 150 })
  title: string;

  @Column({ type: 'varchar', length: 500, nullable: true })
  message: string | null;

  @Column({ type: 'varchar', length: 60, nullable: true })
  entityType: NotificationEntityType | null;

  @Column({ type: 'uuid', nullable: true })
  entityId: string | null;

  // La tienda de la venta que originó el aviso
  @Column({ type: 'uuid', nullable: true })
  locationId: string | null;

  @ManyToOne(() => Location, { nullable: true })
  @JoinColumn({ name: 'locationId' })
  location: Location | null;

  // Quien hizo la acción que originó el aviso: no se le notifica a sí mismo
  @Column({ type: 'uuid', nullable: true })
  actorId: string | null;

  @ManyToOne(() => User, { nullable: true })
  @JoinColumn({ name: 'actorId' })
  actor: User | null;
}
