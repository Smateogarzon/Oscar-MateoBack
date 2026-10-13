import { Column, Entity, Index, JoinColumn, ManyToOne } from 'typeorm';
import { ImmutableEntity } from '../../../common/entities/immutable.entity.js';
import { InternalOrderCorrection } from './internal-order-correction.entity.js';
import { InternalOrderItem } from './internal-order-item.entity.js';

// Una de las líneas que llegaron equivocadas en un retorno por error. El alistamiento pudo fallar en
// varias referencias de la misma orden y el corredor las devuelve todas en el mismo viaje, así que
// la corrección es una sola y aquí quedan las líneas que cubre. Son líneas de la versión que estaba
// vigente cuando se reportó, no necesariamente de la actual. El índice único evita señalar dos veces
// la misma línea en la misma corrección.
@Entity('internal_order_correction_items')
@Index('IDX_internal_order_correction_items_pair', ['correctionId', 'internalOrderItemId'], { unique: true })
export class InternalOrderCorrectionItem extends ImmutableEntity {
  @Column({ type: 'uuid' })
  correctionId: string;

  @ManyToOne(() => InternalOrderCorrection, { nullable: false })
  @JoinColumn({ name: 'correctionId', foreignKeyConstraintName: 'FK_internal_order_correction_items_correction' })
  correction: InternalOrderCorrection;

  @Column({ type: 'uuid' })
  internalOrderItemId: string;

  @ManyToOne(() => InternalOrderItem, { nullable: false })
  @JoinColumn({ name: 'internalOrderItemId', foreignKeyConstraintName: 'FK_internal_order_correction_items_item' })
  item: InternalOrderItem;
}
