import { Decimal } from 'decimal.js';
import { Column, Entity, Index, JoinColumn, ManyToOne } from 'typeorm';
import { ImmutableEntity } from '../../../common/entities/immutable.entity.js';
import { decimalTransformer } from '../../../common/transformers/decimal.transformer.js';
import { SaleItem } from '../../sale/entities/sale-item.entity.js';
import { SaleReturn } from './sale-return.entity.js';

// Una línea de la venta original que se devuelve, con cuántas unidades y cuánto vale lo devuelto.
// Solo se crean, junto con la devolución. La empresa es la de la devolución.
@Entity('sale_return_items')
@Index(['saleReturnId', 'saleItemId'], { unique: true })
export class SaleReturnItem extends ImmutableEntity {
  @Column({ type: 'uuid' })
  saleReturnId: string;

  @ManyToOne(() => SaleReturn, { nullable: false })
  @JoinColumn({ name: 'saleReturnId' })
  saleReturn: SaleReturn;

  // La línea de la venta original
  @Index()
  @Column({ type: 'uuid' })
  saleItemId: string;

  @ManyToOne(() => SaleItem, { nullable: false })
  @JoinColumn({ name: 'saleItemId' })
  saleItem: SaleItem;

  @Column({ type: 'numeric', precision: 12, scale: 2, transformer: decimalTransformer })
  quantity: Decimal;

  // Lo que el cliente realmente pagó por esas unidades, con los descuentos que tuvieron (ver
  // return-values.ts)
  @Column({ type: 'numeric', precision: 14, scale: 2, transformer: decimalTransformer })
  amount: Decimal;
}
