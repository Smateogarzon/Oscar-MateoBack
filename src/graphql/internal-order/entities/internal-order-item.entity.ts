import { Decimal } from 'decimal.js';
import { Column, Entity, Index, JoinColumn, ManyToOne } from 'typeorm';
import { ImmutableEntity } from '../../../common/entities/immutable.entity.js';
import { decimalTransformer } from '../../../common/transformers/decimal.transformer.js';
import { Incident } from '../../incident/entities/incident.entity.js';
import { ProductVariant } from '../../product-variant/entities/product-variant.entity.js';
import { InternalOrder } from './internal-order.entity.js';

// Una línea de una versión de la orden. Las líneas vigentes son las de la versión actual de la
// orden (`versionNumber` = InternalOrder.versionNumber); las de versiones anteriores se conservan
// tal cual, como histórico.
//
// `quantity` es lo pedido. `foundQuantity` es lo que bodega encontró al alistar (o lo que bodega
// contó al recibir una devolución); null hasta entonces. Si es menos, la línea queda con su
// novedad (`incidentId`). `unitPrice`/`discountAmount` solo importan en una SO: es lo que el
// cliente paga, y pasa tal cual a la venta al cobrarla.
@Entity('internal_order_items')
@Index(['internalOrderId', 'versionNumber'])
@Index(['productVariantId'])
export class InternalOrderItem extends ImmutableEntity {
  @Column({ type: 'uuid' })
  internalOrderId: string;

  @ManyToOne(() => InternalOrder, { nullable: false })
  @JoinColumn({ name: 'internalOrderId' })
  internalOrder: InternalOrder;

  @Column({ type: 'int' })
  versionNumber: number;

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

  // Qué es esta línea respecto a la versión anterior ("Cambio de talla: 40 → 41").
  @Column({ type: 'varchar', length: 255, nullable: true })
  notes: string | null;
}
