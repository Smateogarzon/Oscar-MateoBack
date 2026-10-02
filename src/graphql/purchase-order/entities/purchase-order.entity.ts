import { Decimal } from 'decimal.js';
import { Column, Entity, Index, JoinColumn, ManyToOne } from 'typeorm';
import { BaseEntity } from '../../../common/entities/base.entity.js';
import { decimalTransformer } from '../../../common/transformers/decimal.transformer.js';
import { Company } from '../../company/entities/company.entity.js';
import { Location } from '../../location/entities/location.entity.js';
import { User } from '../../user/entities/user.entity.js';
import { PurchaseOrderStatus } from './purchase-order-status.enum.js';

// Una orden de compra a un proveedor. El proveedor NO es una empresa aparte: es un usuario con el
// rol "Proveedor" (ver V0.1_add_role, scope SUPPLIER), que entra a confirmarla y a registrar su
// propia entrega — por eso no hay un paso de "el destino confirma recepción" como en los pedidos
// internos (orders.confirm_receipt): aquí quien dice que llegó es el mismo proveedor
// (suppliers.register_delivery). Sin tabla de líneas todavía (ver purchase-order.service.ts): el
// subtotal y el total se escriben a mano, y recibirla cambia el estado pero no toca inventario —
// no hay de dónde saber qué variante ni cuánto llegó.
@Entity('purchase_orders')
@Index(['companyId', 'orderNumber'], { unique: true })
export class PurchaseOrder extends BaseEntity {
  @Index()
  @Column({ type: 'uuid' })
  companyId: string;

  @ManyToOne(() => Company, { nullable: false })
  @JoinColumn({ name: 'companyId' })
  company: Company;

  @Index()
  @Column({ type: 'uuid' })
  supplierId: string;

  @ManyToOne(() => User, { nullable: false })
  @JoinColumn({ name: 'supplierId' })
  supplier: User;

  // "OC-00001": consecutivo propio, por empresa (ver purchase-order-number.ts).
  @Column({ type: 'varchar', length: 50 })
  orderNumber: string;

  @Index()
  @Column({ type: 'uuid' })
  destinationLocationId: string;

  @ManyToOne(() => Location, { nullable: false })
  @JoinColumn({ name: 'destinationLocationId' })
  destinationLocation: Location;

  @Index()
  @Column({
    type: 'enum',
    enum: PurchaseOrderStatus,
    enumName: 'purchase_order_status',
    default: PurchaseOrderStatus.DRAFT,
  })
  status: PurchaseOrderStatus;

  @Column({ type: 'numeric', precision: 14, scale: 2, default: 0, transformer: decimalTransformer })
  subtotal: Decimal;

  @Column({ type: 'numeric', precision: 14, scale: 2, default: 0, transformer: decimalTransformer })
  total: Decimal;

  @Column({ type: 'timestamptz', nullable: true })
  expectedAt: Date | null;

  @Column({ type: 'varchar', length: 500, nullable: true })
  notes: string | null;

  @Column({ type: 'uuid' })
  createdBy: string;

  @ManyToOne(() => User, { nullable: false })
  @JoinColumn({ name: 'createdBy' })
  createdByUser: User;

  @Column({ type: 'timestamptz', nullable: true })
  confirmedAt: Date | null;

  @Column({ type: 'timestamptz', nullable: true })
  receivedAt: Date | null;

  @Column({ type: 'timestamptz', nullable: true })
  cancelledAt: Date | null;

  @Column({ type: 'uuid', nullable: true })
  cancelledBy: string | null;

  @ManyToOne(() => User, { nullable: true })
  @JoinColumn({ name: 'cancelledBy' })
  cancelledByUser: User | null;

  @Column({ type: 'varchar', length: 255, nullable: true })
  cancellationReason: string | null;
}
