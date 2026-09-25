import { Column, Entity, Index, JoinColumn, ManyToOne } from 'typeorm';
import { ImmutableEntity } from '../../../common/entities/immutable.entity.js';
import { User } from '../../user/entities/user.entity.js';
import { Notification } from './notification.entity.js';

// Un aviso para una persona. Lo único que cambia es readAt (null = sin leer). La empresa es la del
// aviso: "mis notificaciones" siempre se filtra por la empresa activa, porque un usuario puede
// estar en más de una.
@Entity('user_notifications')
@Index(['notificationId', 'userId'], { unique: true })
@Index(['userId', 'readAt'])
@Index(['userId', 'createdAt'])
export class UserNotification extends ImmutableEntity {
  @Column({ type: 'uuid' })
  notificationId: string;

  @ManyToOne(() => Notification, { nullable: false })
  @JoinColumn({ name: 'notificationId' })
  notification: Notification;

  @Column({ type: 'uuid' })
  userId: string;

  @ManyToOne(() => User, { nullable: false })
  @JoinColumn({ name: 'userId' })
  user: User;

  @Column({ type: 'timestamptz', nullable: true })
  readAt: Date | null;
}
