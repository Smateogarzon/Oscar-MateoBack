import { Column, Entity, Index, JoinColumn, ManyToOne } from 'typeorm';
import { BaseEntity } from '../../../common/entities/base.entity.js';
import { RecordStatus } from '../../../common/enums/record-status.enum.js';
import { Company } from '../../company/entities/company.entity.js';
import { PaymentMethodType } from './payment-method-type.enum.js';

// Medio de pago que una empresa acepta al cobrar una venta (efectivo, tarjeta, transferencia...).
// El nombre no se repite dentro de la empresa.
@Entity('payment_methods')
@Index(['companyId', 'name'], { unique: true })
export class PaymentMethod extends BaseEntity {
  @Index()
  @Column({ type: 'uuid' })
  companyId: string;

  @ManyToOne(() => Company, { nullable: false })
  @JoinColumn({ name: 'companyId' })
  company: Company;

  @Column({ type: 'varchar', length: 80 })
  name: string;

  // Define cómo se cuenta el dinero: solo CASH entra a la caja física (ver cash-session-totals.ts).
  // No se cambia después de creado: lo cobrado con este medio en turnos abiertos cambiaría de
  // significado.
  @Column({ type: 'enum', enum: PaymentMethodType, enumName: 'payment_method_type' })
  type: PaymentMethodType;

  // Si es true, cobrar con este medio exige una referencia (voucher, número de transferencia...)
  @Column({ type: 'boolean', default: false })
  requiresReference: boolean;

  @Column({
    type: 'enum',
    enum: RecordStatus,
    enumName: 'record_status',
    default: RecordStatus.ACTIVE,
  })
  status: RecordStatus;
}
