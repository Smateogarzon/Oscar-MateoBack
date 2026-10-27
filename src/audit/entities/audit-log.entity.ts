import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { Company } from '../../graphql/company/entities/company.entity.js';
import { User } from '../../graphql/user/entities/user.entity.js';
import { AuditAction } from './audit-action.enum.js';

// Registro de control, nunca se edita ni se borra desde la app (solo se consulta por base de
// datos): lo llena AuditLogSubscriber automáticamente para las entidades de AUDITABLE_ENTITIES, y
// AuthService a mano para LOGIN/LOGOUT (que no pasan por un guardado de entidad). No extiende
// BaseEntity: no tiene updatedAt, calca el DBML tal cual.
@Entity('audit_logs')
@Index(['companyId'])
@Index(['userId'])
@Index(['entityType'])
@Index(['entityId'])
@Index(['action'])
@Index(['createdAt'])
export class AuditLog {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'uuid', nullable: true })
  companyId: string | null;

  @ManyToOne(() => Company, { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({ name: 'companyId' })
  company: Company | null;

  @Column({ type: 'uuid', nullable: true })
  userId: string | null;

  @ManyToOne(() => User, { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({ name: 'userId' })
  user: User | null;

  @Column({
    type: 'enum',
    enum: AuditAction,
    enumName: 'audit_action',
  })
  action: AuditAction;

  // Nombre de la clase de la entidad (ej. "Sale", "WriteOff"), no el nombre de la tabla.
  @Column({ type: 'varchar', length: 60 })
  entityType: string;

  @Column({ type: 'uuid', nullable: true })
  entityId: string | null;

  @Column({ type: 'jsonb', nullable: true })
  oldValues: Record<string, unknown> | null;

  @Column({ type: 'jsonb', nullable: true })
  newValues: Record<string, unknown> | null;

  @Column({ type: 'varchar', length: 255, nullable: true })
  description: string | null;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt: Date;
}
