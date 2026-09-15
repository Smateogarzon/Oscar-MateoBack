import { Column, Entity } from 'typeorm';
import { BaseEntity } from '../../../common/entities/base.entity.js';
import { CompanyStatus } from './company-status.enum.js';
//esta tabla guarda el registro de las empresas
@Entity('companies')
export class Company extends BaseEntity {
  @Column({ type: 'varchar', length: 120 })
  name: string;

  @Column({ type: 'varchar', length: 180, nullable: true })
  legalName: string | null;

  @Column({ type: 'varchar', length: 30, unique: true })
  taxId: string;

  @Column({ type: 'varchar', length: 2, nullable: true })
  taxIdCheckDigit: string | null;

  @Column({ type: 'varchar', length: 255, nullable: true })
  address: string | null;

  @Column({ type: 'varchar', length: 100, nullable: true })
  city: string | null;

  @Column({ type: 'varchar', length: 2, default: 'CO' })
  countryCode: string;

  @Column({ type: 'varchar', length: 30, nullable: true })
  phone: string | null;

  @Column({ type: 'varchar', length: 150, nullable: true })
  email: string | null;

  @Column({ type: 'text', nullable: true })
  logoUrl: string | null;

  @Column({ type: 'varchar', length: 3, default: 'COP' })
  currencyCode: string;

  @Column({ type: 'varchar', length: 50, default: 'America/Bogota' })
  timezone: string;

  @Column({
    type: 'enum',
    enum: CompanyStatus,
    enumName: 'company_status',
    default: CompanyStatus.ACTIVE,
  })
  status: CompanyStatus;
}
