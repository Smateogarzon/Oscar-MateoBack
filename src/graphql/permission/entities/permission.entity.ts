import { Column, Entity } from 'typeorm';
import { BaseEntity } from '../../../common/entities/base.entity.js';
import { RecordStatus } from '../../../common/enums/record-status.enum.js';
import { PermissionModule } from './permission-module.enum.js';

// Permiso concreto que puede asignarse a un rol (ej: 'sales.create')
@Entity('permissions')
export class Permission extends BaseEntity {
  // Identificador estable para lógica de negocio; "name" es solo para mostrar
  @Column({ type: 'varchar', length: 80, unique: true })
  code: string;

  @Column({ type: 'varchar', length: 120 })
  name: string;

  @Column({ type: 'enum', enum: PermissionModule, enumName: 'permission_module' })
  module: PermissionModule;

  @Column({ type: 'varchar', length: 255, nullable: true })
  description: string | null;

  @Column({
    type: 'enum',
    enum: RecordStatus,
    enumName: 'record_status',
    default: RecordStatus.ACTIVE,
  })
  status: RecordStatus;
}
