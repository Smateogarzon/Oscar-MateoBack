import type { EntityManager } from 'typeorm';
import { InventoryBalance } from './entities/inventory-balance.entity.js';

// La balanza de una variante en una ubicación, bloqueada hasta que termine la transacción. La usan
// InventoryMovementService (ajustarla) e InventoryReservationService (leerla, para saber cuánto
// hay disponible) — la misma fila, así una reserva y un movimiento sobre la misma existencia nunca
// se pisan.
//
// Dos pasos, como una clave de idempotencia: primero un INSERT que no hace nada si ya existe (así
// siempre hay una fila), y luego una lectura bloqueada de esa fila (que ya existe seguro).
export async function lockOrCreateInventoryBalance(
  manager: EntityManager,
  productVariantId: string,
  inventoryLocationId: string,
): Promise<InventoryBalance> {
  await manager.query(
    `INSERT INTO "inventory_balances" ("productVariantId", "inventoryLocationId", "quantity")
     VALUES ($1, $2, 0)
     ON CONFLICT ("productVariantId", "inventoryLocationId") DO NOTHING`,
    [productVariantId, inventoryLocationId],
  );
  const balance = await manager.getRepository(InventoryBalance).findOne({
    where: { productVariantId, inventoryLocationId },
    lock: { mode: 'pessimistic_write' },
  });
  if (!balance) throw new Error('No se pudo crear ni bloquear la existencia: esto no debería pasar');
  return balance;
}
