import { Column, Entity } from 'typeorm';
import { ImmutableEntity } from '../../../common/entities/immutable.entity.js';

// Catálogo de colores, COMPARTIDO entre empresas (igual que las marcas: ver brand.entity.ts) y sin
// ciclo de vida propio (no tiene status ni updatedAt): es una lista de apoyo para armar variantes de
// producto, no algo que se edite después. Lo administra `inventory.manage_products` (lo mismo que
// categorías y productos): quien cataloga mercancía nueva puede agregar el color que le falte,
// sin depender del super administrador.
@Entity('colors')
export class Color extends ImmutableEntity {
  @Column({ type: 'varchar', length: 80, unique: true })
  name: string;

  // "#RRGGBB", si lo dan (sirve para pintar un punto de color en el selector de variantes).
  @Column({ type: 'varchar', length: 7, nullable: true })
  hex: string | null;
}
