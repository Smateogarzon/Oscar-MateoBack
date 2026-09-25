import { Decimal } from 'decimal.js';
import { Column, Entity, Index, JoinColumn, ManyToOne } from 'typeorm';
import { ImmutableEntity } from '../../../common/entities/immutable.entity.js';
import { decimalTransformer } from '../../../common/transformers/decimal.transformer.js';
import { CashSession } from '../../cash-session/entities/cash-session.entity.js';
import { PaymentMethod } from '../../payment-method/entities/payment-method.entity.js';
import { User } from '../../user/entities/user.entity.js';
import { SaleReturn } from './sale-return.entity.js';

// Un pago de vuelta al cliente por una devolución. Un reembolso en efectivo es una salida real del
// cajón: por eso cuelga del turno de caja y baja el efectivo esperado al cerrarlo (ver
// cash-session-totals.ts). Uno por tarjeta o transferencia se registra igual, pero no toca el cajón.
// Solo se crean, junto con el cierre de la devolución. La empresa es la de la devolución.
@Entity('refund_payments')
export class RefundPayment extends ImmutableEntity {
  @Index()
  @Column({ type: 'uuid' })
  saleReturnId: string;

  @ManyToOne(() => SaleReturn, { nullable: false })
  @JoinColumn({ name: 'saleReturnId' })
  saleReturn: SaleReturn;

  @Index()
  @Column({ type: 'uuid' })
  paymentMethodId: string;

  @ManyToOne(() => PaymentMethod, { nullable: false })
  @JoinColumn({ name: 'paymentMethodId' })
  paymentMethod: PaymentMethod;

  @Column({ type: 'numeric', precision: 14, scale: 2, transformer: decimalTransformer })
  amount: Decimal;

  // Voucher, número de transferencia... (obligatoria si el medio de pago la exige)
  @Column({ type: 'varchar', length: 120, nullable: true })
  reference: string | null;

  // El turno de caja desde el que se entregó el reembolso; obligatorio si es en efectivo
  @Index()
  @Column({ type: 'uuid', nullable: true })
  cashSessionId: string | null;

  @ManyToOne(() => CashSession, { nullable: true })
  @JoinColumn({ name: 'cashSessionId' })
  cashSession: CashSession | null;

  // Quien entregó el reembolso
  @Column({ type: 'uuid' })
  paidBy: string;

  @ManyToOne(() => User, { nullable: false })
  @JoinColumn({ name: 'paidBy' })
  payer: User;
}
