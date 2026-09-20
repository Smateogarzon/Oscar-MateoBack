import { Decimal } from 'decimal.js';
import { Column, Entity, Index, JoinColumn, ManyToOne } from 'typeorm';
import { ImmutableEntity } from '../../../common/entities/immutable.entity.js';
import { decimalTransformer } from '../../../common/transformers/decimal.transformer.js';
import { PaymentMethod } from '../../payment-method/entities/payment-method.entity.js';
import { Sale } from '../../sale/entities/sale.entity.js';
import { User } from '../../user/entities/user.entity.js';

// Un pago de una venta. Una venta se puede pagar con varios (efectivo + tarjeta), y todos se
// guardan juntos al completarla (ver SalePaymentService.complete): sus montos suman exactamente
// el total de la venta. Solo se crean, nunca se editan. La empresa de un pago es la de su venta.
@Entity('sale_payments')
export class SalePayment extends ImmutableEntity {
  @Index()
  @Column({ type: 'uuid' })
  saleId: string;

  @ManyToOne(() => Sale, { nullable: false })
  @JoinColumn({ name: 'saleId' })
  sale: Sale;

  @Index()
  @Column({ type: 'uuid' })
  paymentMethodId: string;

  @ManyToOne(() => PaymentMethod, { nullable: false })
  @JoinColumn({ name: 'paymentMethodId' })
  paymentMethod: PaymentMethod;

  // Lo que se aplica a la venta con este medio. El vuelto de un pago en efectivo de más lo maneja
  // quien cobra: aquí solo queda lo que quedó en la caja.
  @Column({ type: 'numeric', precision: 14, scale: 2, transformer: decimalTransformer })
  amount: Decimal;

  // Voucher, número de transferencia... (obligatoria si el medio de pago la exige)
  @Column({ type: 'varchar', length: 120, nullable: true })
  reference: string | null;

  // Quien registró el pago: el cajero, o un administrador que cobró en su turno
  @Column({ type: 'uuid' })
  receivedBy: string;

  @ManyToOne(() => User, { nullable: false })
  @JoinColumn({ name: 'receivedBy' })
  receiver: User;
}
