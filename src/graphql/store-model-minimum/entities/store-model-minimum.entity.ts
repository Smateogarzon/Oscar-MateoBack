import { Decimal } from 'decimal.js';
import { Column, Entity, Index, JoinColumn, ManyToOne } from 'typeorm';
import { BaseEntity } from '../../../common/entities/base.entity.js';
import { decimalTransformer } from '../../../common/transformers/decimal.transformer.js';
import { Color } from '../../color/entities/color.entity.js';
import { Company } from '../../company/entities/company.entity.js';
import { Location } from '../../location/entities/location.entity.js';
import { Product } from '../../product/entities/product.entity.js';

// Cuántas unidades de un MODELO —una referencia en un color, sumando todas sus tallas— debe haber
// en el mostrador de una tienda. Es una política, no una existencia: la fila vive aunque la tienda
// esté en cero, y es justamente lo que convierte "aquí hay 2 pares" en "aquí faltan 4".
//
// Por modelo y no por talla (decisión del usuario, 2026-10-20): una vitrina se arma por referencia y
// color, y las tallas se reponen con lo que haya. El mínimo por talla sigue existiendo aparte, en
// `inventory_balances.minStock`, que es el que usan las bodegas.
//
// Se escribe al surtir —cada línea del traslado puede traer el mínimo de su modelo— y se corrige en
// Inventario sin tener que mandar otro traslado. Quitarlo es borrar la fila: sin fila no hay mínimo,
// y sin mínimo esa referencia no aparece en "qué pedir".
@Entity('store_model_minimums')
@Index('IDX_store_model_minimums_model', ['companyId', 'locationId', 'productId', 'colorId'], { unique: true })
export class StoreModelMinimum extends BaseEntity {
  @Index()
  @Column({ type: 'uuid' })
  companyId: string;

  @ManyToOne(() => Company, { nullable: false })
  @JoinColumn({ name: 'companyId' })
  company: Company;

  // Siempre una tienda: una bodega no tiene mostrador (lo exige StoreModelMinimumService.assertStore).
  @Index()
  @Column({ type: 'uuid' })
  locationId: string;

  @ManyToOne(() => Location, { nullable: false })
  @JoinColumn({ name: 'locationId' })
  location: Location;

  @Column({ type: 'uuid' })
  productId: string;

  @ManyToOne(() => Product, { nullable: false })
  @JoinColumn({ name: 'productId' })
  product: Product;

  @Column({ type: 'uuid' })
  colorId: string;

  @ManyToOne(() => Color, { nullable: false })
  @JoinColumn({ name: 'colorId' })
  color: Color;

  @Column({ type: 'numeric', precision: 12, scale: 2, transformer: decimalTransformer })
  minQuantity: Decimal;
}
