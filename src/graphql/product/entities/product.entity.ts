import { Column, Entity, Index, JoinColumn, ManyToOne } from 'typeorm';
import { BaseEntity } from '../../../common/entities/base.entity.js';
import { RecordStatus } from '../../../common/enums/record-status.enum.js';
import { Brand } from '../../brand/entities/brand.entity.js';
import { Category } from '../../category/entities/category.entity.js';
import { Company } from '../../company/entities/company.entity.js';

// Un producto (un modelo de zapato) DE UNA EMPRESA: sus variantes (color × talla, ver
// product-variant.entity.ts) son las que de verdad se venden. La marca es del catálogo
// compartido y opcional (hay productos sin marca); la categoría es propia de la empresa y
// obligatoria. Se desactiva, no se borra (igual que categorías).
@Entity('products')
@Index(['companyId', 'reference'], { unique: true })
export class Product extends BaseEntity {
  @Index()
  @Column({ type: 'uuid' })
  companyId: string;

  @ManyToOne(() => Company, { nullable: false })
  @JoinColumn({ name: 'companyId' })
  company: Company;

  @Index()
  @Column({ type: 'uuid', nullable: true })
  brandId: string | null;

  @ManyToOne(() => Brand, { nullable: true })
  @JoinColumn({ name: 'brandId' })
  brand: Brand | null;

  @Index()
  @Column({ type: 'uuid' })
  categoryId: string;

  @ManyToOne(() => Category, { nullable: false })
  @JoinColumn({ name: 'categoryId' })
  category: Category;

  @Column({ type: 'varchar', length: 180 })
  name: string;

  // Código de estilo interno de la empresa (lo que en la zapatería se llama "la referencia"); único
  // por empresa, no globalmente. El SKU que sí identifica cada unidad vendible vive en la variante.
  @Column({ type: 'varchar', length: 100 })
  reference: string;

  @Column({ type: 'text', nullable: true })
  description: string | null;

  @Column({
    type: 'enum',
    enum: RecordStatus,
    enumName: 'record_status',
    default: RecordStatus.ACTIVE,
  })
  status: RecordStatus;
}
