import { Decimal } from 'decimal.js';
import { Column, Entity, Index, JoinColumn, ManyToOne } from 'typeorm';
import { ImmutableEntity } from '../../../common/entities/immutable.entity.js';
import { decimalTransformer } from '../../../common/transformers/decimal.transformer.js';
import { CashSession } from '../../cash-session/entities/cash-session.entity.js';
import { User } from '../../user/entities/user.entity.js';
import { CashMovementReason } from './cash-movement-reason.enum.js';
import { CashMovementType } from './cash-movement-type.enum.js';

// Ingreso o egreso de efectivo de un turno que no es una venta (un gasto, un retiro a la bóveda,
// una devolución...). Solo se crean, nunca se editan: si algo se registró mal, se compensa con un
// movimiento de ajuste. La empresa de un movimiento es la de su turno.
@Entity('cash_movements')
export class CashMovement extends ImmutableEntity {
  @Index()
  @Column({ type: 'uuid' })
  cashSessionId: string;

  @ManyToOne(() => CashSession, { nullable: false })
  @JoinColumn({ name: 'cashSessionId' })
  cashSession: CashSession;

  @Index()
  @Column({ type: 'enum', enum: CashMovementType, enumName: 'cash_movement_type' })
  type: CashMovementType;

  @Column({ type: 'enum', enum: CashMovementReason, enumName: 'cash_movement_reason' })
  reason: CashMovementReason;

  // Siempre positivo: el sentido lo da `type`
  @Column({ type: 'numeric', precision: 14, scale: 2, transformer: decimalTransformer })
  amount: Decimal;

  @Column({ type: 'varchar', length: 255, nullable: true })
  description: string | null;

  // Número de un comprobante externo (recibo, consignación...)
  @Column({ type: 'varchar', length: 100, nullable: true })
  referenceNumber: string | null;

  @Column({ type: 'uuid' })
  createdBy: string;

  @ManyToOne(() => User, { nullable: false })
  @JoinColumn({ name: 'createdBy' })
  creator: User;
}
