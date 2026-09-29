import { Column, Entity } from 'typeorm';
import { ImmutableEntity } from '../../../common/entities/immutable.entity.js';

// Catálogo de tallas, igual de compartido y sin ciclo de vida que colors (ver color.entity.ts).
@Entity('sizes')
export class Size extends ImmutableEntity {
  @Column({ type: 'varchar', length: 30, unique: true })
  name: string;
}
