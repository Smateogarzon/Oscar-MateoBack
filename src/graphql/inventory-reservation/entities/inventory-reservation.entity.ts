import { Decimal } from 'decimal.js';
import { Column, Entity, Index, JoinColumn, ManyToOne } from 'typeorm';
import { ImmutableEntity } from '../../../common/entities/immutable.entity.js';
import { decimalTransformer } from '../../../common/transformers/decimal.transformer.js';
import { InventorySide } from '../../inventory-balance/entities/inventory-side.enum.js';
import { InventoryLocation } from '../../inventory-location/entities/inventory-location.entity.js';
import { InventorySourceType } from '../../inventory-movement/entities/inventory-source-type.enum.js';
import { ProductVariant } from '../../product-variant/entities/product-variant.entity.js';

// Existencia prometida pero todavía sin mover (por ejemplo, para una venta en curso que ya eligió
// una variante): "aparta" contra la existencia disponible para que otra venta no prometa lo mismo.
// Solo se crea o se borra (ImmutableEntity, sin updatedAt): liberarla es borrar la fila, no
// editarla. No toca inventory_balances directamente — InventoryReservationService.create bloquea
// la balanza (el mismo mecanismo que InventoryMovementService) para comprobar que lo disponible
// (existencia menos lo ya reservado) alcanza, antes de apartar más.
@Entity('inventory_reservations')
@Index(['productVariantId', 'inventoryLocationId', 'side'])
export class InventoryReservation extends ImmutableEntity {
  @Index()
  @Column({ type: 'uuid' })
  productVariantId: string;

  @ManyToOne(() => ProductVariant, { nullable: false })
  @JoinColumn({ name: 'productVariantId' })
  productVariant: ProductVariant;

  @Index()
  @Column({ type: 'uuid' })
  inventoryLocationId: string;

  @ManyToOne(() => InventoryLocation, { nullable: false })
  @JoinColumn({ name: 'inventoryLocationId' })
  inventoryLocation: InventoryLocation;

  @Column({ type: 'enum', enum: InventorySide, enumName: 'inventory_side' })
  side: InventorySide;

  @Column({ type: 'numeric', precision: 12, scale: 2, transformer: decimalTransformer })
  quantity: Decimal;

  @Column({ type: 'enum', enum: InventorySourceType, enumName: 'inventory_source_type' })
  sourceType: InventorySourceType;

  // Nulo en una reserva manual (MANUAL_ADJUSTMENT): no nace de ningún documento.
  @Column({ type: 'uuid', nullable: true })
  sourceId: string | null;

  @Column({ type: 'varchar', length: 50, nullable: true })
  sourceNumber: string | null;
}
