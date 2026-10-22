import type { EntityManager } from 'typeorm';
import { Location } from '../../graphql/location/entities/location.entity.js';

/**
 * Qué tienda vende solo de lo suyo.
 *
 * Esto era un par de interruptores: `Location.directSale` (la tienda no tiene corredores) y
 * `Category.directSale` (esa mercancía vive en la tienda en cualquier tienda, como la ropa). El
 * segundo se fue: lo que se cobra ya no lo decide una categoría sino la EXISTENCIA —se cobra lo que
 * está en la tienda y se pide lo que no (ver `InventoryBalanceService.findStockLocationForSale`)—,
 * así que marcar la ropa dejó de hacer falta.
 *
 * Queda el primero, que dice algo que la existencia no puede decir: si esa tienda tiene a alguien
 * que le traiga mercancía. Una tienda sin corredores no le pide nada a bodega.
 */

/** ¿Esa tienda no tiene corredores y vende solo de lo suyo? Una sede que no existe, no. */
export async function isDirectStore(manager: EntityManager, companyId: string, storeId: string): Promise<boolean> {
  const store = await manager.getRepository(Location).findOne({
    where: { id: storeId, companyId },
    select: { id: true, directSale: true },
  });
  return store?.directSale ?? false;
}
