import { Decimal } from 'decimal.js';
import { Column, Entity, Index, JoinColumn, ManyToOne, PrimaryGeneratedColumn } from 'typeorm';
import { decimalTransformer } from '../../../common/transformers/decimal.transformer.js';
import { SaleItem } from '../../sale/entities/sale-item.entity.js';
import { DiscountRequest } from './discount-request.entity.js';

// El descuento de UNA línea dentro de una solicitud: cada línea lleva su propio monto (10 % en
// una, 5 % en otra). Una solicitud sobre toda la venta no tiene filas aquí. Al aprobarse, el
// monto aprobado se escribe en sale_items.discountAmount de esa línea.
// Si la línea se borra de la venta (solo se puede cuando la solicitud ya no está activa), su fila
// se va con ella.
@Entity('discount_request_items')
@Index(['discountRequestId', 'saleItemId'], { unique: true })
export class DiscountRequestItem {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'uuid' })
  discountRequestId: string;

  @ManyToOne(() => DiscountRequest, { nullable: false })
  @JoinColumn({ name: 'discountRequestId' })
  discountRequest: DiscountRequest;

  @Index()
  @Column({ type: 'uuid' })
  saleItemId: string;

  @ManyToOne(() => SaleItem, { nullable: false, onDelete: 'CASCADE' })
  @JoinColumn({ name: 'saleItemId' })
  saleItem: SaleItem;

  // Monto que se pidió descontar en esta línea
  @Column({ type: 'numeric', precision: 14, scale: 2, transformer: decimalTransformer })
  requestedDiscount: Decimal;

  // Monto que el administrador aprobó para esta línea; vacío mientras no se aprueba
  @Column({ type: 'numeric', precision: 14, scale: 2, nullable: true, transformer: decimalTransformer })
  approvedDiscount: Decimal | null;
}
