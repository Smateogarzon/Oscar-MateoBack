import { Column, Entity, Index } from 'typeorm';
import { BaseEntity } from '../../../common/entities/base.entity.js';
import { RecordStatus } from '../../../common/enums/record-status.enum.js';

// Cuenta de usuario para login y autenticación
@Entity('users')
export class User extends BaseEntity {
  @Column({ type: 'varchar', length: 80 })
  firstName: string;

  @Column({ type: 'varchar', length: 80 })
  lastName: string;

  @Column({ type: 'varchar', length: 150, unique: true })
  email: string;

  @Column({ type: 'varchar', length: 30, nullable: true })
  phone: string | null;

  @Index()
  @Column({ type: 'varchar', length: 30, nullable: true })
  documentNumber: string | null;

  // Hash de la contraseña (bcrypt/argon2); nunca se expone en el DTO de GraphQL
  @Column({ type: 'text' })
  passwordHash: string;

  @Column({ type: 'text', nullable: true })
  avatarUrl: string | null;

  @Index()
  @Column({
    type: 'enum',
    enum: RecordStatus,
    enumName: 'record_status',
    default: RecordStatus.ACTIVE,
  })
  status: RecordStatus;

  // Fuerza cambio de contraseña en el próximo login (ej: usuario creado por un admin)
  @Column({ type: 'boolean', default: true })
  mustChangePassword: boolean;

  @Column({ type: 'timestamptz', nullable: true })
  lastLoginAt: Date | null;
}
