import { Column, CreateDateColumn, Entity, Index, JoinColumn, ManyToOne, PrimaryGeneratedColumn } from 'typeorm';
import { Product } from '../../product/entities/product.entity.js';
import { User } from '../../user/entities/user.entity.js';
import { ProductDeletionRequestStatus } from './product-deletion-request-status.enum.js';

// Solicitud para borrar una referencia (Product): quien no puede borrarla directo (sin
// inventory.manage_products) la pide, y un administrador la aprueba (la borra o la desactiva,
// según corresponda — ver ProductService.deleteReference) o la rechaza. Un producto tiene a lo
// sumo UNA solicitud activa (pendiente); el índice único parcial de abajo lo garantiza aunque el
// servicio falle. La empresa de una solicitud es la de su producto.
@Entity('product_deletion_requests')
@Index(['productId'], { unique: true, where: `"status" = 'PENDING'` })
export class ProductDeletionRequest {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Index()
  @Column({ type: 'uuid' })
  productId: string;

  @ManyToOne(() => Product, { nullable: false })
  @JoinColumn({ name: 'productId' })
  product: Product;

  @Column({ type: 'uuid' })
  requestedBy: string;

  @ManyToOne(() => User, { nullable: false })
  @JoinColumn({ name: 'requestedBy' })
  requester: User;

  // Quien la resolvió: la aprobó, la rechazó o la canceló (el último que la tocó).
  @Column({ type: 'uuid', nullable: true })
  resolvedBy: string | null;

  @ManyToOne(() => User, { nullable: true })
  @JoinColumn({ name: 'resolvedBy' })
  resolver: User | null;

  @Column({ type: 'varchar', length: 255, nullable: true })
  reason: string | null;

  @Column({ type: 'varchar', length: 255, nullable: true })
  resolutionNotes: string | null;

  @Index()
  @Column({
    type: 'enum',
    enum: ProductDeletionRequestStatus,
    enumName: 'product_deletion_request_status',
    default: ProductDeletionRequestStatus.PENDING,
  })
  status: ProductDeletionRequestStatus;

  @CreateDateColumn({ type: 'timestamptz' })
  requestedAt: Date;

  @Column({ type: 'timestamptz', nullable: true })
  resolvedAt: Date | null;
}
