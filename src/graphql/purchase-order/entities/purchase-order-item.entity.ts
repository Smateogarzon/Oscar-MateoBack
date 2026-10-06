import { Decimal } from 'decimal.js';
import { Column, Entity, Index, JoinColumn, ManyToOne } from 'typeorm';
import { BaseEntity } from '../../../common/entities/base.entity.js';
import { decimalTransformer } from '../../../common/transformers/decimal.transformer.js';
import { Incident } from '../../incident/entities/incident.entity.js';
import { ProductVariant } from '../../product-variant/entities/product-variant.entity.js';
import { PurchaseOrder } from './purchase-order.entity.js';

// Una línea de una orden de compra, con las tres cifras del recorrido (ver
// purchase-order-status.enum.ts):
//   quantity          lo que pidió el administrador
//   shippedQuantity   lo que contó y despachó el proveedor (null hasta que despacha)
//   receivedQuantity  lo que contó el bodeguero al recibir (null hasta que la acepta); es ESTA la
//                     que entra al inventario
// Cada vez que una cifra queda por debajo de la anterior —o por encima, al recibir— nace una
// novedad y la línea la guarda: `shipmentIncidentId` la del proveedor, `receptionIncidentId` la de
// bodega (ver purchase-order-incidents.ts). A diferencia de las líneas de una baja, esta sí se
// edita (por eso BaseEntity y no ImmutableEntity): solo cambian esas cifras y sus novedades. Las
// llaves de las novedades llevan los nombres con los que las crea V0.2_add_counts_and_incidents.
@Entity('purchase_order_items')
@Index(['purchaseOrderId', 'productVariantId'], { unique: true })
@Index(['productVariantId'])
export class PurchaseOrderItem extends BaseEntity {
  @Column({ type: 'uuid' })
  purchaseOrderId: string;

  @ManyToOne(() => PurchaseOrder, { nullable: false })
  @JoinColumn({ name: 'purchaseOrderId' })
  purchaseOrder: PurchaseOrder;

  @Column({ type: 'uuid' })
  productVariantId: string;

  @ManyToOne(() => ProductVariant, { nullable: false })
  @JoinColumn({ name: 'productVariantId' })
  productVariant: ProductVariant;

  @Column({ type: 'numeric', precision: 12, scale: 2, transformer: decimalTransformer })
  quantity: Decimal;

  @Column({ type: 'numeric', precision: 12, scale: 2, nullable: true, transformer: decimalTransformer })
  shippedQuantity: Decimal | null;

  @Column({ type: 'numeric', precision: 12, scale: 2, nullable: true, transformer: decimalTransformer })
  receivedQuantity: Decimal | null;

  @Column({ type: 'uuid', nullable: true })
  shipmentIncidentId: string | null;

  @ManyToOne(() => Incident, { nullable: true })
  @JoinColumn({ name: 'shipmentIncidentId', foreignKeyConstraintName: 'FK_purchase_order_items_shipmentIncidentId' })
  shipmentIncident: Incident | null;

  @Column({ type: 'uuid', nullable: true })
  receptionIncidentId: string | null;

  @ManyToOne(() => Incident, { nullable: true })
  @JoinColumn({ name: 'receptionIncidentId', foreignKeyConstraintName: 'FK_purchase_order_items_receptionIncidentId' })
  receptionIncident: Incident | null;

  @Column({ type: 'numeric', precision: 14, scale: 2, transformer: decimalTransformer })
  unitCost: Decimal;
}
