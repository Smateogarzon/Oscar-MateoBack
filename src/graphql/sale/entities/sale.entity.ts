import { Decimal } from 'decimal.js';
import { Column, Entity, Index, JoinColumn, ManyToOne } from 'typeorm';
import { BaseEntity } from '../../../common/entities/base.entity.js';
import { decimalTransformer } from '../../../common/transformers/decimal.transformer.js';
import { CashSession } from '../../cash-session/entities/cash-session.entity.js';
import { Company } from '../../company/entities/company.entity.js';
import { Location } from '../../location/entities/location.entity.js';
import { User } from '../../user/entities/user.entity.js';
import { SaleStatus } from './sale-status.enum.js';

// Venta hecha en una tienda. Nace en borrador cuando el cajero da "nueva venta"; el subtotal,
// el descuento y el total los calcula el servidor a partir de sus líneas (ver sale-totals.ts).
@Entity('sales')
@Index(['companyId', 'saleNumber'], { unique: true })
export class Sale extends BaseEntity {
  @Column({ type: 'uuid' })
  companyId: string;

  @ManyToOne(() => Company, { nullable: false })
  @JoinColumn({ name: 'companyId' })
  company: Company;

  // Tienda (sede de tipo STORE) donde se hace la venta
  @Index()
  @Column({ type: 'uuid' })
  storeId: string;

  @ManyToOne(() => Location, { nullable: false })
  @JoinColumn({ name: 'storeId' })
  store: Location;

  // Pedido interno del que viene la venta. Todavía no hay tabla de pedidos internos: por eso
  // no tiene llave foránea; se agrega en la migración que la cree.
  @Index()
  @Column({ type: 'uuid', nullable: true })
  internalOrderId: string | null;

  // Consecutivo por empresa (VTA-000001); lo entrega DocumentSequenceService
  @Column({ type: 'varchar', length: 50 })
  saleNumber: string;

  // Quien atendió al cliente
  @Index()
  @Column({ type: 'uuid', nullable: true })
  sellerId: string | null;

  @ManyToOne(() => User, { nullable: true })
  @JoinColumn({ name: 'sellerId' })
  seller: User | null;

  // Quien cobra: el usuario que da "nueva venta"
  @Index()
  @Column({ type: 'uuid' })
  cashierId: string;

  @ManyToOne(() => User, { nullable: false })
  @JoinColumn({ name: 'cashierId' })
  cashier: User;

  // Turno de caja en el que se cobró: se llena al completar la venta (SalePaymentService.complete)
  // y queda vacío mientras es borrador o si se cancela.
  @Index()
  @Column({ type: 'uuid', nullable: true })
  cashSessionId: string | null;

  @ManyToOne(() => CashSession, { nullable: true })
  @JoinColumn({ name: 'cashSessionId' })
  cashSession: CashSession | null;

  @Column({ type: 'numeric', precision: 14, scale: 2, default: 0, transformer: decimalTransformer })
  subtotal: Decimal;

  // Todos los descuentos: los de cada línea más el descuento general de la venta
  @Column({ type: 'numeric', precision: 14, scale: 2, default: 0, transformer: decimalTransformer })
  discountTotal: Decimal;

  // Descuento aprobado sobre TODA la venta: el monto de su solicitud activa y aprobada, si esa
  // solicitud es sobre toda la venta (cero si no). Los descuentos por línea viven en cada línea.
  // Está separado para poder recalcular discountTotal cuando cambian las líneas.
  @Column({ type: 'numeric', precision: 14, scale: 2, default: 0, transformer: decimalTransformer })
  generalDiscount: Decimal;

  @Column({ type: 'numeric', precision: 14, scale: 2, default: 0, transformer: decimalTransformer })
  total: Decimal;

  @Column({
    type: 'enum',
    enum: SaleStatus,
    enumName: 'sale_status',
    default: SaleStatus.DRAFT,
  })
  status: SaleStatus;

  @Column({ type: 'uuid', nullable: true })
  cancelledBy: string | null;

  @ManyToOne(() => User, { nullable: true })
  @JoinColumn({ name: 'cancelledBy' })
  canceller: User | null;

  @Column({ type: 'varchar', length: 255, nullable: true })
  cancellationReason: string | null;

  @Column({ type: 'timestamptz', nullable: true })
  cancelledAt: Date | null;

  @Column({ type: 'timestamptz', nullable: true })
  completedAt: Date | null;
}
