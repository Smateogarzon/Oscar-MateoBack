import { Column, Entity } from 'typeorm';
import { BaseEntity } from '../../../common/entities/base.entity.js';
import { RecordStatus } from '../../../common/enums/record-status.enum.js';
import { RoleScope } from './role-scope.enum.js';

// Rol asignable a un usuario (ej: admin, vendedor, comprador)
@Entity('roles')
export class Role extends BaseEntity {
  // Identificador estable para lógica de negocio (ej: 'ADMIN'); "name" es solo para mostrar
  @Column({ type: 'varchar', length: 50, unique: true })
  code: string;

  @Column({ type: 'varchar', length: 100 })
  name: string;

  @Column({ type: 'varchar', length: 255, nullable: true })
  description: string | null;

  @Column({ type: 'enum', enum: RoleScope, enumName: 'role_scope' })
  scope: RoleScope;

  @Column({
    type: 'enum',
    enum: RecordStatus,
    enumName: 'record_status',
    default: RecordStatus.ACTIVE,
  })
  status: RecordStatus;
}
