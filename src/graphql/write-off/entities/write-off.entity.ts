import { Column, Entity, Index, JoinColumn, ManyToOne, PrimaryGeneratedColumn } from 'typeorm';
import { Company } from '../../company/entities/company.entity.js';
import { Location } from '../../location/entities/location.entity.js';
import { User } from '../../user/entities/user.entity.js';
import { WriteOffStatus } from './write-off-status.enum.js';

// Una baja de inventario: existencia que se da de baja (perdida, vencida, dañada sin remedio...),
// pedida por alguien y aprobada por un administrador antes de que de verdad se descuente (ver
// WriteOffService.approve, que crea el inventory_movement tipo ADJUSTMENT en ese momento, no
// antes). Igual que una solicitud de descuento o de devolución: pedir no mueve nada todavía.
// No extiende BaseEntity: no tiene updatedAt, y su fecha de creación se llama requestedAt.
@Entity('write_offs')
@Index(['companyId', 'writeOffNumber'], { unique: true })
@Index(['companyId', 'status'])
export class WriteOff {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Index()
  @Column({ type: 'uuid' })
  companyId: string;

  @ManyToOne(() => Company, { nullable: false })
  @JoinColumn({ name: 'companyId' })
  company: Company;

  @Index()
  @Column({ type: 'uuid' })
  locationId: string;

  @ManyToOne(() => Location, { nullable: false })
  @JoinColumn({ name: 'locationId' })
  location: Location;

  // "BAJA-00001": consecutivo propio, por empresa (ver write-off-number.ts).
  @Column({ type: 'varchar', length: 50 })
  writeOffNumber: string;

  @Column({
    type: 'enum',
    enum: WriteOffStatus,
    enumName: 'write_off_status',
    default: WriteOffStatus.PENDING,
  })
  status: WriteOffStatus;

  @Column({ type: 'varchar', length: 255, nullable: true })
  reason: string | null;

  @Column({ type: 'varchar', length: 500, nullable: true })
  notes: string | null;

  @Column({ type: 'uuid' })
  requestedBy: string;

  @ManyToOne(() => User, { nullable: false })
  @JoinColumn({ name: 'requestedBy' })
  requestedByUser: User;

  // Quien la aprobó, rechazó o canceló (las tres pasan por aquí: no hay una columna aparte para
  // cada una, igual que en el diagrama).
  @Column({ type: 'uuid', nullable: true })
  resolvedBy: string | null;

  @ManyToOne(() => User, { nullable: true })
  @JoinColumn({ name: 'resolvedBy' })
  resolvedByUser: User | null;

  @Column({ type: 'timestamptz' })
  requestedAt: Date;

  @Column({ type: 'timestamptz', nullable: true })
  resolvedAt: Date | null;
}
