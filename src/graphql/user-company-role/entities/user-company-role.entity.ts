import { Column, Entity, Index, JoinColumn, ManyToOne } from 'typeorm';
import { BaseEntity } from '../../../common/entities/base.entity.js';
import { RecordStatus } from '../../../common/enums/record-status.enum.js';
import { Company } from '../../company/entities/company.entity.js';
import { Role } from '../../role/entities/role.entity.js';
import { User } from '../../user/entities/user.entity.js';

// Membresía: qué rol tiene un usuario dentro de una empresa puntual (soporta multi-empresa)
@Entity('user_company_roles')
@Index(['userId', 'companyId', 'roleId'], { unique: true })
export class UserCompanyRole extends BaseEntity {
  @Column({ type: 'uuid' })
  userId: string;

  @ManyToOne(() => User, { nullable: false })
  @JoinColumn({ name: 'userId' })
  user: User;

  @Index()
  @Column({ type: 'uuid' })
  companyId: string;

  @ManyToOne(() => Company, { nullable: false })
  @JoinColumn({ name: 'companyId' })
  company: Company;

  @Index()
  @Column({ type: 'uuid' })
  roleId: string;

  @ManyToOne(() => Role, { nullable: false })
  @JoinColumn({ name: 'roleId' })
  role: Role;

  @Column({
    type: 'enum',
    enum: RecordStatus,
    enumName: 'record_status',
    default: RecordStatus.ACTIVE,
  })
  status: RecordStatus;
}
