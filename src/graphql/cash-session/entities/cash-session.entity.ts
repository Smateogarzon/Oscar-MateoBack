import { Decimal } from 'decimal.js';
import { Column, Entity, Index, JoinColumn, ManyToOne } from 'typeorm';
import { BaseEntity } from '../../../common/entities/base.entity.js';
import { decimalTransformer } from '../../../common/transformers/decimal.transformer.js';
import { CashRegister } from '../../cash-register/entities/cash-register.entity.js';
import { User } from '../../user/entities/user.entity.js';
import { CashSessionStatus } from './cash-session-status.enum.js';

// Turno de una caja: desde que el administrador la abre para un cajero, con un monto inicial, hasta
// que la cierra contando el efectivo. El cajero asignado es el único que cobra y mueve dinero en él.
// A lo sumo hay UN turno abierto por caja y UNO por cajero (un solo cajero por caja): los dos
// índices parciales lo hacen cumplir en la base de datos aunque dos aperturas lleguen a la vez.
// La empresa de un turno es la de la tienda de su caja.
// No estaban en el modelo: cashierId, movementCode, movementCodeFailures y updatedAt (la fila se
// edita al cerrar).
@Entity('cash_sessions')
@Index(['cashRegisterId'], { unique: true, where: `"status" = 'OPEN'` })
@Index(['cashierId'], { unique: true, where: `"status" = 'OPEN'` })
export class CashSession extends BaseEntity {
  @Index()
  @Column({ type: 'uuid' })
  cashRegisterId: string;

  @ManyToOne(() => CashRegister, { nullable: false })
  @JoinColumn({ name: 'cashRegisterId' })
  cashRegister: CashRegister;

  // El administrador que abrió el turno
  @Column({ type: 'uuid' })
  openedBy: string;

  @ManyToOne(() => User, { nullable: false })
  @JoinColumn({ name: 'openedBy' })
  opener: User;

  // El cajero que trabaja el turno: el único que cobra y mueve dinero en él
  @Index()
  @Column({ type: 'uuid' })
  cashierId: string;

  @ManyToOne(() => User, { nullable: false })
  @JoinColumn({ name: 'cashierId' })
  cashier: User;

  // El administrador que lo cerró
  @Column({ type: 'uuid', nullable: true })
  closedBy: string | null;

  @ManyToOne(() => User, { nullable: true })
  @JoinColumn({ name: 'closedBy' })
  closer: User | null;

  // Efectivo con el que arranca la caja
  @Column({ type: 'numeric', precision: 14, scale: 2, default: 0, transformer: decimalTransformer })
  openingAmount: Decimal;

  // Al cerrar: lo que el sistema dice que debe haber (ver cash-session-totals.ts)
  @Column({ type: 'numeric', precision: 14, scale: 2, nullable: true, transformer: decimalTransformer })
  expectedAmount: Decimal | null;

  // Al cerrar: lo que se contó
  @Column({ type: 'numeric', precision: 14, scale: 2, nullable: true, transformer: decimalTransformer })
  countedAmount: Decimal | null;

  // Al cerrar: contado − esperado (negativo si falta efectivo)
  @Column({ type: 'numeric', precision: 14, scale: 2, nullable: true, transformer: decimalTransformer })
  differenceAmount: Decimal | null;

  @Index()
  @Column({
    type: 'enum',
    enum: CashSessionStatus,
    enumName: 'cash_session_status',
    default: CashSessionStatus.OPEN,
  })
  status: CashSessionStatus;

  // El código del día (ver cash-code.ts): 6 dígitos que se crean al abrir el turno y valen hasta que
  // se cierra. Solo el administrador lo ve; el cajero se lo pide para cada movimiento de caja. Nunca
  // sale en el tipo GraphQL de un turno.
  @Column({ type: 'varchar', length: 6 })
  movementCode: string;

  // Códigos equivocados seguidos; al llegar a MAX_CASH_CODE_FAILURES se bloquean los movimientos
  // del turno hasta que el administrador genere otro código
  @Column({ type: 'int', default: 0 })
  movementCodeFailures: number;

  @Column({ type: 'timestamptz', default: () => 'now()' })
  openedAt: Date;

  @Column({ type: 'timestamptz', nullable: true })
  closedAt: Date | null;

  // Al cerrar; obligatorias si hay diferencia
  @Column({ type: 'varchar', length: 255, nullable: true })
  notes: string | null;
}
