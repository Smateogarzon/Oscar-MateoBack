import { Column, Entity, Index, JoinColumn, ManyToOne } from 'typeorm';
import { ImmutableEntity } from '../../../common/entities/immutable.entity.js';
import { Company } from '../../company/entities/company.entity.js';
import { Permission } from '../../permission/entities/permission.entity.js';
import { Role } from '../../role/entities/role.entity.js';

// Qué permisos tiene cada rol EN CADA EMPRESA: los roles y los permisos son un catálogo
// común, pero cada empresa decide qué puede hacer cada rol dentro de ella.
// El índice y la llave de empresa llevan nombre explícito porque la migración
// V0.3_add_company_to_role-permission los crea a mano.
@Entity('role_permissions')
@Index('IDX_role_permissions_company_role_permission', ['companyId', 'roleId', 'permissionId'], {
  unique: true,
})
export class RolePermission extends ImmutableEntity {
  @Column({ type: 'uuid' })
  companyId: string;

  @ManyToOne(() => Company, { nullable: false })
  @JoinColumn({ name: 'companyId', foreignKeyConstraintName: 'FK_role_permissions_company' })
  company: Company;

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
