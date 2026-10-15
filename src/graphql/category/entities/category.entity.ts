import { Column, Entity, Index, JoinColumn, ManyToOne } from 'typeorm';
import { BaseEntity } from '../../../common/entities/base.entity.js';
import { RecordStatus } from '../../../common/enums/record-status.enum.js';
import { Company } from '../../company/entities/company.entity.js';

// Categoría de productos DE UNA EMPRESA (a diferencia de las marcas, que son compartidas: ver
// brand.entity.ts): cada empresa arma su propio árbol, aunque dos usen el mismo nombre. Se
// desactiva, no se borra (igual que sedes, usuarios y cajas): una categoría con historial de
// productos no puede desaparecer sin dejar rastro. `parentId` la anida bajo otra de la misma
// empresa; sin él, es una categoría raíz.
@Entity('categories')
@Index(['companyId', 'parentId'])
export class Category extends BaseEntity {
  @Index()
  @Column({ type: 'uuid' })
  companyId: string;

  @ManyToOne(() => Company, { nullable: false })
  @JoinColumn({ name: 'companyId' })
  company: Company;

  @Column({ type: 'varchar', length: 120 })
  name: string;

  // La arma el servicio a partir del nombre (ver slugify.ts); nadie la escribe a mano. Única por
  // empresa, no globalmente: dos empresas pueden tener la misma.
  @Column({ type: 'varchar', length: 140 })
  slug: string;

  // Categoría padre, de la misma empresa; null = categoría raíz.
  @Column({ type: 'uuid', nullable: true })
  parentId: string | null;

  @ManyToOne(() => Category, { nullable: true })
  @JoinColumn({ name: 'parentId' })
  parent: Category | null;

  @Column({ type: 'varchar', length: 255, nullable: true })
  description: string | null;

  @Column({
    type: 'enum',
    enum: RecordStatus,
    enumName: 'record_status',
    default: RecordStatus.ACTIVE,
  })
  status: RecordStatus;
}
