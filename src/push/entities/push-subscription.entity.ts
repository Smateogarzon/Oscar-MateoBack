import { Column, Entity, Index, JoinColumn, ManyToOne } from 'typeorm';
import { BaseEntity } from '../../common/entities/base.entity.js';
import { Company } from '../../graphql/company/entities/company.entity.js';
import { User } from '../../graphql/user/entities/user.entity.js';

// Un dispositivo de una persona para avisos del sistema (web push), dentro de una empresa. Una persona
// puede tener varios (el celular y la computadora). `p256dh` y `auth` son los secretos con que se cifra
// cada aviso: no se exponen por GraphQL y no entran a la auditoría.
@Entity('push_subscriptions')
@Index(['userId', 'companyId', 'endpoint'], { unique: true })
@Index(['companyId', 'userId'])
export class PushSubscription extends BaseEntity {
  @Column({ type: 'uuid' })
  userId: string;

  @ManyToOne(() => User, { nullable: false, onDelete: 'CASCADE' })
  @JoinColumn({ name: 'userId' })
  user: User;

  @Column({ type: 'uuid' })
  companyId: string;

  @ManyToOne(() => Company, { nullable: false, onDelete: 'CASCADE' })
  @JoinColumn({ name: 'companyId' })
  company: Company;

  // La dirección que entregó el navegador (la del servicio de push). Varía por navegador y dispositivo.
  @Column({ type: 'varchar', length: 1024 })
  endpoint: string;

  @Column({ type: 'varchar', length: 255 })
  p256dh: string;

  @Column({ type: 'varchar', length: 255 })
  auth: string;

  @Column({ type: 'varchar', length: 255, nullable: true })
  userAgent: string | null;

  // Avisos que el servicio de push rechazó seguidos. Al llegar al tope la suscripción se borra.
  @Column({ type: 'int', default: 0 })
  failureCount: number;

  @Column({ type: 'timestamptz', nullable: true })
  lastSuccessAt: Date | null;

  // Cuándo se registró o se volvió a confirmar desde ese dispositivo: sirve para echar la más vieja.
  @Column({ type: 'timestamptz' })
  lastSeenAt: Date;
}
