import { Column, Entity, JoinColumn, ManyToOne, PrimaryColumn } from 'typeorm';
import { Company } from '../../company/entities/company.entity.js';

// Contador de una serie de numeración (ventas, pedidos...) dentro de una empresa: guarda el
// último número entregado. Lo usa DocumentSequenceService; no se expone por GraphQL.
@Entity('document_sequences')
export class DocumentSequence {
  @PrimaryColumn({ type: 'uuid' })
  companyId: string;

  @ManyToOne(() => Company, { nullable: false })
  @JoinColumn({ name: 'companyId' })
  company: Company;

  // Qué se numera (ej: 'SALE')
  @PrimaryColumn({ type: 'varchar', length: 30 })
  series: string;

  @Column({ type: 'int', default: 0 })
  lastValue: number;
}
