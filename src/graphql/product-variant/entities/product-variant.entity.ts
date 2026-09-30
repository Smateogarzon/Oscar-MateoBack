import { Decimal } from 'decimal.js';
import { Column, Entity, Index, JoinColumn, ManyToOne } from 'typeorm';
import { BaseEntity } from '../../../common/entities/base.entity.js';
import { decimalTransformer } from '../../../common/transformers/decimal.transformer.js';
import { RecordStatus } from '../../../common/enums/record-status.enum.js';
import { Color } from '../../color/entities/color.entity.js';
import { Company } from '../../company/entities/company.entity.js';
import { Product } from '../../product/entities/product.entity.js';
import { Size } from '../../size/entities/size.entity.js';

// La unidad que de verdad se vende: un producto en un color y una talla. `companyId` va repetido
// aquí (se puede sacar por product.companyId) porque el SKU es único POR EMPRESA, y Postgres no
// deja hacer un índice único que cruce dos tablas: sin esta columna no habría dónde colgarlo. Color
// y talla son obligatorios: en esta zapatería no se vende nada sin las dos cosas definidas. Se
// desactiva, no se borra (igual que productos y categorías).
@Entity('product_variants')
@Index(['companyId', 'sku'], { unique: true })
@Index(['productId', 'colorId', 'sizeId'], { unique: true })
export class ProductVariant extends BaseEntity {
  @Index()
  @Column({ type: 'uuid' })
  companyId: string;

  @ManyToOne(() => Company, { nullable: false })
  @JoinColumn({ name: 'companyId' })
  company: Company;

  @Index()
  @Column({ type: 'uuid' })
  productId: string;

  @ManyToOne(() => Product, { nullable: false })
  @JoinColumn({ name: 'productId' })
  product: Product;

  @Index()
  @Column({ type: 'uuid' })
  colorId: string;

  @ManyToOne(() => Color, { nullable: false })
  @JoinColumn({ name: 'colorId' })
  color: Color;

  @Index()
  @Column({ type: 'uuid' })
  sizeId: string;

  @ManyToOne(() => Size, { nullable: false })
  @JoinColumn({ name: 'sizeId' })
  size: Size;

  @Column({ type: 'varchar', length: 100, unique: true })
  sku: string;

  @Column({
    type: 'numeric',
    precision: 14,
    scale: 2,
    transformer: decimalTransformer,
  })
  cost: Decimal;

  @Column({
    type: 'numeric',
    precision: 14,
    scale: 2,
    transformer: decimalTransformer,
  })
  price: Decimal;

  @Column({ type: 'text', nullable: true })
  imageUrl: string | null;

  @Column({
    type: 'enum',
    enum: RecordStatus,
    enumName: 'record_status',
    default: RecordStatus.ACTIVE,
  })
  status: RecordStatus;
}
