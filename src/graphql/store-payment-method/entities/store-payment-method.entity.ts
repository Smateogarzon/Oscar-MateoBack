import { Column, Entity, Index, JoinColumn, ManyToOne } from 'typeorm';
import { ImmutableEntity } from '../../../common/entities/immutable.entity.js';
import { RecordStatus } from '../../../common/enums/record-status.enum.js';
import { Location } from '../../location/entities/location.entity.js';
import { PaymentMethod } from '../../payment-method/entities/payment-method.entity.js';

// Qué medios de pago acepta cada tienda. Los medios son de la empresa (nacen con ella, ver
// default-payment-methods.ts); esto es solo la lista de los que una tienda concreta admite al
// cobrar. Una fila ACTIVE = lo acepta; INACTIVE = lo dejó de aceptar (se apaga y se prende, como
// el acceso de un usuario a una sede).
@Entity('store_payment_methods')
@Index(['storeId', 'paymentMethodId'], { unique: true })
export class StorePaymentMethod extends ImmutableEntity {
  @Column({ type: 'uuid' })
  storeId: string;

  @ManyToOne(() => Location, { nullable: false })
  @JoinColumn({ name: 'storeId' })
  store: Location;

  @Column({ type: 'uuid' })
  paymentMethodId: string;

  @ManyToOne(() => PaymentMethod, { nullable: false })
  @JoinColumn({ name: 'paymentMethodId' })
  paymentMethod: PaymentMethod;

  @Column({
    type: 'enum',
    enum: RecordStatus,
    enumName: 'record_status',
    default: RecordStatus.ACTIVE,
  })
  status: RecordStatus;
}
