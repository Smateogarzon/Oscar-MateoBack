import { Decimal } from 'decimal.js';
import { Column, Entity, Index, JoinColumn, ManyToOne } from 'typeorm';
import { BaseEntity } from '../../../common/entities/base.entity.js';
import { decimalTransformer } from '../../../common/transformers/decimal.transformer.js';
import { Company } from '../../company/entities/company.entity.js';
import { Sale } from '../../sale/entities/sale.entity.js';
import { User } from '../../user/entities/user.entity.js';
import { SaleReturnResolution } from './sale-return-resolution.enum.js';
import { SaleReturnStatus } from './sale-return-status.enum.js';

// Devolución de una venta ya cobrada. La venta original NUNCA se modifica: la devolución es un
// documento aparte (DEV-…) que apunta a ella. El cajero la registra, un administrador la aprueba y
// se completa cuando se entrega el dinero (REFUND) o se cobra la venta nueva del cambio
// (EXCHANGE); si el cambio es por algo más barato, la diferencia se devuelve en dinero
// (PARTIAL_REFUND). El número es consecutivo por empresa.
// No estaban en el modelo: updatedAt, resolvedBy, resolvedAt y resolutionNotes (la aprobación).
@Entity('sale_returns')
@Index(['companyId', 'returnNumber'], { unique: true })
export class SaleReturn extends BaseEntity {
  @Index()
  @Column({ type: 'uuid' })
  companyId: string;

  @ManyToOne(() => Company, { nullable: false })
  @JoinColumn({ name: 'companyId' })
  company: Company;

  // La venta original que se devuelve
  @Index()
  @Column({ type: 'uuid' })
  saleId: string;

  @ManyToOne(() => Sale, { nullable: false })
  @JoinColumn({ name: 'saleId' })
  sale: Sale;

  @Column({ type: 'varchar', length: 50 })
  returnNumber: string;

  @Column({
    type: 'enum',
    enum: SaleReturnResolution,
    enumName: 'sale_return_resolution',
  })
  resolution: SaleReturnResolution;

  // La venta nueva de un cambio, cuando ya se cobró
  @Index()
  @Column({ type: 'uuid', nullable: true })
  replacementSaleId: string | null;

  @ManyToOne(() => Sale, { nullable: true })
  @JoinColumn({ name: 'replacementSaleId' })
  replacementSale: Sale | null;

  // Lo que vale lo devuelto: suma de lo que el cliente realmente pagó por esas unidades
  @Column({ type: 'numeric', precision: 14, scale: 2, transformer: decimalTransformer })
  totalReturned: Decimal;

  // Lo que se devolvió en dinero (refund_payments); cero hasta que se entrega
  @Column({ type: 'numeric', precision: 14, scale: 2, default: 0, transformer: decimalTransformer })
  refundAmount: Decimal;

  @Index()
  @Column({
    type: 'enum',
    enum: SaleReturnStatus,
    enumName: 'sale_return_status',
    default: SaleReturnStatus.PENDING,
  })
  status: SaleReturnStatus;

  @Column({ type: 'varchar', length: 255, nullable: true })
  reason: string | null;

  // Quien la registró: el cajero
  @Column({ type: 'uuid' })
  processedBy: string;

  @ManyToOne(() => User, { nullable: false })
  @JoinColumn({ name: 'processedBy' })
  processor: User;

  // Quien la aprobó, la rechazó o la canceló
  @Column({ type: 'uuid', nullable: true })
  resolvedBy: string | null;

  @ManyToOne(() => User, { nullable: true })
  @JoinColumn({ name: 'resolvedBy' })
  resolver: User | null;

  @Column({ type: 'timestamptz', nullable: true })
  resolvedAt: Date | null;

  @Column({ type: 'varchar', length: 255, nullable: true })
  resolutionNotes: string | null;

  // Quién la aprobó y cuándo: se escribe UNA vez, al aprobarla, y nadie lo pisa. resolvedBy/resolvedAt
  // son de la última acción (aprobar, rechazar o cancelar), así que sin esto, cancelar una devolución
  // aprobada borraba quién la había aprobado.
  @Column({ type: 'uuid', nullable: true })
  approvedBy: string | null;

  @Column({ type: 'timestamptz', nullable: true })
  approvedAt: Date | null;

  // El último administrador que cambió las líneas mientras estaba pendiente (las líneas anteriores se
  // reemplazan: queda al menos quién y cuándo)
  @Column({ type: 'uuid', nullable: true })
  lastEditedBy: string | null;

  @Column({ type: 'timestamptz', nullable: true })
  lastEditedAt: Date | null;

  // Quién la canceló y cuándo
  @Column({ type: 'uuid', nullable: true })
  cancelledBy: string | null;

  @Column({ type: 'timestamptz', nullable: true })
  cancelledAt: Date | null;

  @Column({ type: 'timestamptz', nullable: true })
  completedAt: Date | null;
}
