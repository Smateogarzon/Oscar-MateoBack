import { Decimal } from 'decimal.js';
import { Column, Entity, Index, JoinColumn, ManyToOne } from 'typeorm';
import { BaseEntity } from '../../../common/entities/base.entity.js';
import { decimalTransformer } from '../../../common/transformers/decimal.transformer.js';
import { SaleItemType } from './sale-item-type.enum.js';
import { Sale } from './sale.entity.js';

// Línea de una venta. Quien arma la venta agrega y quita líneas, y puede cambiar la cantidad de
// una (su precio y su descripción no cambian). El descuento de una línea solo cambia cuando se
// aprueba, edita o cancela una solicitud de descuento (DiscountRequestService), y mientras hay una
// solicitud activa no se cambian cantidades ni se quitan líneas. La empresa de una línea es la de
// su venta. Los totales de la venta salen de sus líneas (ver sale-totals.ts).
@Entity('sale_items')
export class SaleItem extends BaseEntity {
  @Index()
  @Column({ type: 'uuid' })
  saleId: string;

  @ManyToOne(() => Sale, { nullable: false })
  @JoinColumn({ name: 'saleId' })
  sale: Sale;

  @Column({ type: 'enum', enum: SaleItemType, enumName: 'sale_item_type' })
  type: SaleItemType;

  // Variante de producto vendida (solo INVENTORIED). Todavía no hay catálogo: sin llave
  // foránea por ahora; se agrega en la migración que cree product_variants.
  @Index()
  @Column({ type: 'uuid', nullable: true })
  productVariantId: string | null;

  @Column({ type: 'varchar', length: 180 })
  description: string;

  @Column({ type: 'varchar', length: 100, nullable: true })
  sku: string | null;

  @Column({ type: 'numeric', precision: 12, scale: 2, transformer: decimalTransformer })
  quantity: Decimal;

  @Column({ type: 'numeric', precision: 14, scale: 2, transformer: decimalTransformer })
  unitPrice: Decimal;

  // Descuento aprobado de esta línea (cero si no tiene); el de toda la venta vive en
  // sales.generalDiscount
  @Column({ type: 'numeric', precision: 14, scale: 2, default: 0, transformer: decimalTransformer })
  discountAmount: Decimal;

  // cantidad × precio unitario − descuento de la línea
  @Column({ type: 'numeric', precision: 14, scale: 2, transformer: decimalTransformer })
  total: Decimal;
}
