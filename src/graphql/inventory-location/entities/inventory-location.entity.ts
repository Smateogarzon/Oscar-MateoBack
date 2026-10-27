import { Column, Entity, Index, JoinColumn, ManyToOne } from 'typeorm';
import { BaseEntity } from '../../../common/entities/base.entity.js';
import { RecordStatus } from '../../../common/enums/record-status.enum.js';
import { Company } from '../../company/entities/company.entity.js';
import { Location } from '../../location/entities/location.entity.js';
import { User } from '../../user/entities/user.entity.js';
import { InventoryLocationType } from './inventory-location-type.enum.js';

// Un "cajón" donde vive existencia (ver inventory-location-type.enum.ts). No nace solo: a
// diferencia de la caja de una tienda, esto se crea a mano (InventoryLocationService.create), y
// puede haber más de uno del mismo tipo para la misma sede (dos bodegas, por ejemplo — igual que
// una tienda puede tener más de una caja).
@Entity('inventory_locations')
@Index(['companyId', 'type'])
export class InventoryLocation extends BaseEntity {
  @Index()
  @Column({ type: 'uuid' })
  companyId: string;

  @ManyToOne(() => Company, { nullable: false })
  @JoinColumn({ name: 'companyId' })
  company: Company;

  // Sede a la que pertenece (bodega o tienda). Obligatoria en STOCK/DISPLAY/DAMAGED/RETURNS,
  // vacía en RUNNER (que se ubica por su custodio) y libre en TRANSIT (ver
  // InventoryLocationService.assertShape).
  @Index()
  @Column({ type: 'uuid', nullable: true })
  locationId: string | null;

  @ManyToOne(() => Location, { nullable: true })
  @JoinColumn({ name: 'locationId' })
  location: Location | null;

  @Column({ type: 'enum', enum: InventoryLocationType, enumName: 'inventory_location_type' })
  type: InventoryLocationType;

  // Quién lo tiene encima (el corredor), en un RUNNER; vacío en cualquier otro tipo.
  @Column({ type: 'uuid', nullable: true })
  custodianUserId: string | null;

  @ManyToOne(() => User, { nullable: true })
  @JoinColumn({ name: 'custodianUserId' })
  custodianUser: User | null;

  @Column({
    type: 'enum',
    enum: RecordStatus,
    enumName: 'record_status',
    default: RecordStatus.ACTIVE,
  })
  status: RecordStatus;
}
