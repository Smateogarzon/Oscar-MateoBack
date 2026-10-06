import { Decimal } from 'decimal.js';
import { Column, Entity, Index, JoinColumn, ManyToOne, PrimaryGeneratedColumn, UpdateDateColumn } from 'typeorm';
import { decimalTransformer } from '../../../common/transformers/decimal.transformer.js';
import { ProductVariant } from '../../product-variant/entities/product-variant.entity.js';
import { InventoryLocation } from '../../inventory-location/entities/inventory-location.entity.js';

// La existencia ACTUAL de una variante en un "cajón" (ver InventoryLocation): una foto, no un
// historial (eso es inventory_movements). Nunca se escribe directo: la mantiene
// InventoryMovementService.record cada vez que se guarda un movimiento, dentro de la misma
// transacción y con la fila bloqueada (ver ese servicio). Por eso no tiene create/update propios ni
// companyId: se llega a ella por su variante o por su inventory_location, y ninguna de las dos
// cambia de empresa después de creada.
// El índice único lleva el nombre con el que lo crea V0.7_drop_inventory_side: sin él, TypeORM
// generaría un nombre propio y cada migration:generate propondría borrarlo y volver a crearlo.
@Entity('inventory_balances')
@Index('IDX_inventory_balances_variant_location', ['productVariantId', 'inventoryLocationId'], { unique: true })
export class InventoryBalance {
  @PrimaryGeneratedColumn('uuid')
  id: string;

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

  @Column({ type: 'numeric', precision: 12, scale: 2, default: 0, transformer: decimalTransformer })
  quantity: Decimal;

  // Dónde queda dentro del cajón (un rack, un estante): "Rack A-14 · Nivel 2". La pone quien
  // registra el movimiento que hace crecer esta balanza (ver CreateInventoryMovementInput.position
  // e InventoryMovementService.record); sin eso, queda como estaba.
  @Column({ type: 'varchar', length: 120, nullable: true })
  position: string | null;

  // Debajo de esta cantidad la existencia se considera baja: el listado de inventario avisa. Se pone
  // desde CreateInventoryMovementInput.minStock o UpdateInventoryBalanceMinStockInput, y solo en la
  // balanza de destino.
  @Column({ type: 'numeric', precision: 12, scale: 2, nullable: true, transformer: decimalTransformer })
  minStock: Decimal | null;

  @UpdateDateColumn({ type: 'timestamptz' })
  updatedAt: Date;
}
