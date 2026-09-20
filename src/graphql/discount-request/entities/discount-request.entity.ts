import { Decimal } from 'decimal.js';
import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { decimalTransformer } from '../../../common/transformers/decimal.transformer.js';
import { Sale } from '../../sale/entities/sale.entity.js';
import { User } from '../../user/entities/user.entity.js';
import { DiscountRequestStatus } from './discount-request-status.enum.js';

// Solicitud de descuento sobre una venta: el cajero la pide y un administrador la aprueba (con
// los montos que decida, dentro del tope del 30 %) o la rechaza; el administrador también puede
// editar los montos de una ya aprobada. Solo la aprobada descuenta. Una venta tiene a lo sumo UNA
// solicitud activa, pendiente o aprobada; el índice único parcial de abajo lo garantiza aunque el
// servicio falle. Mientras hay una activa no se quitan líneas de la venta.
//
// Es de UNO de dos tipos: sobre toda la venta (un solo monto, sin líneas) o sobre líneas, cada
// una con su propio monto (ver DiscountRequestItem). requestedDiscount y approvedDiscount son
// siempre el TOTAL: el monto único, o la suma de los de las líneas.
// La empresa de una solicitud es la de su venta.
@Entity('discount_requests')
@Index(['saleId'], { unique: true, where: `"status" IN ('PENDING', 'APPROVED')` })
export class DiscountRequest {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Index()
  @Column({ type: 'uuid' })
  saleId: string;

  @ManyToOne(() => Sale, { nullable: false })
  @JoinColumn({ name: 'saleId' })
  sale: Sale;

  @Column({ type: 'uuid' })
  requestedBy: string;

  @ManyToOne(() => User, { nullable: false })
  @JoinColumn({ name: 'requestedBy' })
  requester: User;

  // Quien la resolvió: la aprobó, la rechazó, la editó o la canceló (el último que la tocó)
  @Column({ type: 'uuid', nullable: true })
  resolvedBy: string | null;

  @ManyToOne(() => User, { nullable: true })
  @JoinColumn({ name: 'resolvedBy' })
  resolver: User | null;

  // Total que se pide descontar
  @Column({ type: 'numeric', precision: 14, scale: 2, transformer: decimalTransformer })
  requestedDiscount: Decimal;

  // Total que el administrador aprobó; vacío mientras no se aprueba
  @Column({ type: 'numeric', precision: 14, scale: 2, nullable: true, transformer: decimalTransformer })
  approvedDiscount: Decimal | null;

  @Column({ type: 'varchar', length: 255, nullable: true })
  reason: string | null;

  @Column({ type: 'varchar', length: 255, nullable: true })
  resolutionNotes: string | null;

  @Index()
  @Column({
    type: 'enum',
    enum: DiscountRequestStatus,
    enumName: 'discount_request_status',
    default: DiscountRequestStatus.PENDING,
  })
  status: DiscountRequestStatus;

  @CreateDateColumn({ type: 'timestamptz' })
  requestedAt: Date;

  @Column({ type: 'timestamptz', nullable: true })
  resolvedAt: Date | null;
}
