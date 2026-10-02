import { Decimal } from 'decimal.js';
import { Column, Entity, Index, JoinColumn, ManyToOne } from 'typeorm';
import { ImmutableEntity } from '../../../common/entities/immutable.entity.js';
import { decimalTransformer } from '../../../common/transformers/decimal.transformer.js';
import { Company } from '../../company/entities/company.entity.js';
import { InventoryLocation } from '../../inventory-location/entities/inventory-location.entity.js';
import { InventorySide } from '../../inventory-balance/entities/inventory-side.enum.js';
import { ProductVariant } from '../../product-variant/entities/product-variant.entity.js';
import { User } from '../../user/entities/user.entity.js';
import { InventoryMovementType } from './inventory-movement-type.enum.js';
import { InventorySourceType } from './inventory-source-type.enum.js';

// El kárdex: cada vez que existencia se mueve, queda una fila, y nunca se edita ni se borra (por
// eso ImmutableEntity, no BaseEntity). InventoryMovementService.record es la ÚNICA forma de crear
// una: ajusta inventory_balances en la misma transacción, con las filas bloqueadas, y guarda esto
// como comprobante. Al menos uno de from/to viene lleno (una compra no tiene from; una venta no
// tiene to: el par sale del sistema).
@Entity('inventory_movements')
@Index(['companyId', 'productVariantId'])
export class InventoryMovement extends ImmutableEntity {
  @Index()
  @Column({ type: 'uuid' })
  companyId: string;

  @ManyToOne(() => Company, { nullable: false })
  @JoinColumn({ name: 'companyId' })
  company: Company;

  @Index()
  @Column({ type: 'uuid' })
  productVariantId: string;

  @ManyToOne(() => ProductVariant, { nullable: false })
  @JoinColumn({ name: 'productVariantId' })
  productVariant: ProductVariant;

  @Index()
  @Column({ type: 'uuid', nullable: true })
  fromLocationId: string | null;

  @ManyToOne(() => InventoryLocation, { nullable: true })
  @JoinColumn({ name: 'fromLocationId' })
  fromLocation: InventoryLocation | null;

  @Index()
  @Column({ type: 'uuid', nullable: true })
  toLocationId: string | null;

  @ManyToOne(() => InventoryLocation, { nullable: true })
  @JoinColumn({ name: 'toLocationId' })
  toLocation: InventoryLocation | null;

  @Column({ type: 'enum', enum: InventorySide, enumName: 'inventory_side' })
  side: InventorySide;

  @Column({ type: 'numeric', precision: 12, scale: 2, transformer: decimalTransformer })
  quantity: Decimal;

  @Column({ type: 'enum', enum: InventoryMovementType, enumName: 'inventory_movement_type' })
  type: InventoryMovementType;

  // De qué documento salió (una venta, una devolución, ...). sourceId queda vacío en un movimiento
  // manual (sin un documento detrás, p. ej. INITIAL_STOCK cargado a mano).
  @Column({ type: 'enum', enum: InventorySourceType, enumName: 'inventory_source_type' })
  sourceType: InventorySourceType;

  @Column({ type: 'uuid', nullable: true })
  sourceId: string | null;

  @Column({ type: 'varchar', length: 50, nullable: true })
  sourceNumber: string | null;

  @Column({ type: 'varchar', length: 255, nullable: true })
  notes: string | null;

  @Column({ type: 'uuid' })
  createdBy: string;

  @ManyToOne(() => User, { nullable: false })
  @JoinColumn({ name: 'createdBy' })
  createdByUser: User;
}
