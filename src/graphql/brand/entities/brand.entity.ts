import { Column, Entity } from 'typeorm';
import { BaseEntity } from '../../../common/entities/base.entity.js';
import { RecordStatus } from '../../../common/enums/record-status.enum.js';

// Catálogo de marcas COMPARTIDO entre todas las empresas (a propósito no lleva companyId): "Nike"
// es la misma fila para Óscar y Mateo y para Hecho con amor. Lo administra solo el super
// administrador (permiso inventory.manage_catalog), para que una empresa no le cambie el nombre o
// el logo a una marca que la otra también usa. Las categorías, en cambio, sí son por empresa (ver
// category.entity.ts).
@Entity('brands')
export class Brand extends BaseEntity {
  @Column({ type: 'varchar', length: 120, unique: true })
  name: string;

  // La arma el servicio a partir del nombre (ver slugify.ts); nadie la escribe a mano.
  @Column({ type: 'varchar', length: 140, unique: true })
  slug: string;

  @Column({ type: 'text', nullable: true })
  logoUrl: string | null;

  @Column({
    type: 'enum',
    enum: RecordStatus,
    enumName: 'record_status',
    default: RecordStatus.ACTIVE,
  })
  status: RecordStatus;
}
