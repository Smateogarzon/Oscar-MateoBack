import { Decimal } from 'decimal.js';
import { Column, Entity, Index, JoinColumn, ManyToOne } from 'typeorm';
import { BaseEntity } from '../../../common/entities/base.entity.js';
import { decimalTransformer } from '../../../common/transformers/decimal.transformer.js';
import { Company } from '../../company/entities/company.entity.js';
import { Location } from '../../location/entities/location.entity.js';
import { User } from '../../user/entities/user.entity.js';
import { PurchaseOrderStatus } from './purchase-order-status.enum.js';

// Una orden de compra a un proveedor. El proveedor NO es una empresa aparte: es un usuario con el
// rol "Proveedor" (ver V0.1_add_role, scope SUPPLIER). El recorrido está en
// purchase-order-status.enum.ts: la arma el administrador, la despacha el proveedor (contando lo
// que manda) y la recibe el bodeguero (contando lo que llega). Las líneas (variante, cantidad,
// costo) están en PurchaseOrderItem: el subtotal y el total salen de ellas, y la existencia entra
// al inventario solo cuando el bodeguero la acepta (ver PurchaseOrderReceivingService).
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

  // Alguna línea quedó con novedad (el proveedor mandó de menos o de más, o bodega no contó lo
  // mismo que él). Se guarda acá, y no se calcula desde las líneas, para que la lista de órdenes
  // pueda pintarlas distinto sin traerse las líneas de todas (ver OrderLines y ORDER_STATUS_DISPLAY).
  @Column({ type: 'boolean', default: false })
  hasIncidents: boolean;

  @Column({ type: 'numeric', precision: 14, scale: 2, default: 0, transformer: decimalTransformer })
  subtotal: Decimal;

  @Column({ type: 'numeric', precision: 14, scale: 2, default: 0, transformer: decimalTransformer })
  total: Decimal;

  @Column({ type: 'timestamptz', nullable: true })
  expectedAt: Date | null;

  @Column({ type: 'uuid' })
  createdBy: string;

  @ManyToOne(() => User, { nullable: false })
  @JoinColumn({ name: 'createdBy' })
  createdByUser: User;

  // Cuándo despachó el proveedor; quién fue no se guarda porque siempre es `supplierId`.
  @Column({ type: 'timestamptz', nullable: true })
  shippedAt: Date | null;

  // Cuándo la aceptó bodega y qué bodeguero la contó. La llave lleva el nombre con el que la crea
  // V0.3_rework_purchase-order-flow.
  @Column({ type: 'timestamptz', nullable: true })
  receivedAt: Date | null;

  @Column({ type: 'uuid', nullable: true })
  receivedBy: string | null;

  @ManyToOne(() => User, { nullable: true })
  @JoinColumn({ name: 'receivedBy', foreignKeyConstraintName: 'FK_purchase_orders_receivedBy' })
  receivedByUser: User | null;

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
