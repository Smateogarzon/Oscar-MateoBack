import { Column, Entity, Index, JoinColumn, ManyToOne } from 'typeorm';
import { ImmutableEntity } from '../../../common/entities/immutable.entity.js';
import { Permission } from '../../permission/entities/permission.entity.js';
import { Role } from '../../role/entities/role.entity.js';

// Qué permisos tiene cada rol
@Entity('role_permissions')
@Index(['roleId', 'permissionId'], { unique: true })
export class RolePermission extends ImmutableEntity {
  @Column({ type: 'uuid' })
  roleId: string;

  @ManyToOne(() => Role, { nullable: false })
  @JoinColumn({ name: 'roleId' })
  role: Role;

  @Column({ type: 'uuid' })
  permissionId: string;

  @ManyToOne(() => Permission, { nullable: false })
  @JoinColumn({ name: 'permissionId' })
  permission: Permission;
}
