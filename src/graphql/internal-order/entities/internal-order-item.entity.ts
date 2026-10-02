import { Decimal } from 'decimal.js';
import { Column, Entity, Index, JoinColumn, ManyToOne } from 'typeorm';
import { ImmutableEntity } from '../../../common/entities/immutable.entity.js';
import { decimalTransformer } from '../../../common/transformers/decimal.transformer.js';
import { Incident } from '../../incident/entities/incident.entity.js';
import { ProductVariant } from '../../product-variant/entities/product-variant.entity.js';
import { InternalOrder } from './internal-order.entity.js';

// Una línea de un pedido interno. `quantity` es lo pedido; `foundQuantity` es lo que bodega
// encontró de verdad al alistar (null hasta entonces). Si `foundQuantity` < `quantity`,
// InternalOrderService.markReady enlaza una novedad por `incidentId`. `unitPrice`/`discountAmount`
// solo importan en un pedido CUSTOMER_REQUEST (lo que el cliente paga); en los demás tipos quedan
// en null/0 y no significan nada.
@Entity('internal_order_items')
@Index(['internalOrderId'])
@Index(['productVariantId'])
export class InternalOrderItem extends ImmutableEntity {
  @Column({ type: 'uuid' })
  internalOrderId: string;

  @ManyToOne(() => InternalOrder, { nullable: false })
  @JoinColumn({ name: 'internalOrderId' })
  internalOrder: InternalOrder;

  @Column({ type: 'uuid' })
  productVariantId: string;

  @ManyToOne(() => ProductVariant, { nullable: false })
  @JoinColumn({ name: 'productVariantId' })
  productVariant: ProductVariant;

  @Column({ type: 'numeric', precision: 12, scale: 2, transformer: decimalTransformer })
  quantity: Decimal;

  @Column({ type: 'numeric', precision: 12, scale: 2, nullable: true, transformer: decimalTransformer })
  foundQuantity: Decimal | null;

  @Column({ type: 'uuid', nullable: true })
  incidentId: string | null;

  @ManyToOne(() => Incident, { nullable: true })
  @JoinColumn({ name: 'incidentId' })
  incident: Incident | null;

  @Column({ type: 'numeric', precision: 14, scale: 2, nullable: true, transformer: decimalTransformer })
  unitPrice: Decimal | null;

  @Column({ type: 'numeric', precision: 14, scale: 2, default: 0, transformer: decimalTransformer })
  discountAmount: Decimal;

  @Column({ type: 'varchar', length: 255, nullable: true })
  notes: string | null;
}
