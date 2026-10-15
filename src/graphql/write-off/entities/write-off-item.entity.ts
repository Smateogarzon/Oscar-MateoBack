import { Decimal } from 'decimal.js';
import { Column, Entity, Index, JoinColumn, ManyToOne } from 'typeorm';
import { ImmutableEntity } from '../../../common/entities/immutable.entity.js';
import { decimalTransformer } from '../../../common/transformers/decimal.transformer.js';
import { Incident } from '../../incident/entities/incident.entity.js';
import { ProductVariant } from '../../product-variant/entities/product-variant.entity.js';
import { WriteOff } from './write-off.entity.js';

// Una línea de una baja: cuánto se da de baja de una variante. Si viene de una novedad (una
// avería o una pérdida ya reportada), `incidentId` la enlaza para no reportar dos veces lo mismo.
@Entity('write_off_items')
@Index(['writeOffId'])
@Index(['productVariantId'])
export class WriteOffItem extends ImmutableEntity {
  @Column({ type: 'uuid' })
  writeOffId: string;

  @ManyToOne(() => WriteOff, { nullable: false })
  @JoinColumn({ name: 'writeOffId' })
  writeOff: WriteOff;

  @Column({ type: 'uuid' })
  productVariantId: string;

  @ManyToOne(() => ProductVariant, { nullable: false })
  @JoinColumn({ name: 'productVariantId' })
  productVariant: ProductVariant;

  @Column({ type: 'numeric', precision: 12, scale: 2, transformer: decimalTransformer })
  quantity: Decimal;

  @Column({ type: 'uuid', nullable: true })
  incidentId: string | null;

  @ManyToOne(() => Incident, { nullable: true })
  @JoinColumn({ name: 'incidentId' })
  incident: Incident | null;

  @Column({ type: 'varchar', length: 255, nullable: true })
  notes: string | null;
}
