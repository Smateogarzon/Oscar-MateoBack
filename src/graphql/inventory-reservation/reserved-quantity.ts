import { Decimal } from 'decimal.js';
import { In, type EntityManager } from 'typeorm';
import type { InventorySourceType } from '../inventory-movement/entities/inventory-source-type.enum.js';
import { InventoryReservation } from './entities/inventory-reservation.entity.js';

// Funciones sueltas, no un servicio, a propósito: así InventoryMovementService puede preguntar por lo
// apartado sin depender de InventoryReservationService (que a su vez necesita las balanzas), y no se
// arma un círculo de módulos.

// Lo ya apartado de una existencia concreta (variante + bodega), por cualquier documento. No hay
// excepciones por documento: quien va a mover lo que él mismo apartó (una venta al cobrarse) suelta
// antes su reserva con `releaseReservations`, dentro de la misma transacción. Así nadie puede pedir
// desde afuera que no se cuente lo que aparta otro.
export async function reservedQuantity(
  manager: EntityManager,
  productVariantId: string,
  inventoryLocationId: string,
): Promise<Decimal> {
  const rows: { sum: string | null }[] = await manager.query(
    `SELECT COALESCE(SUM("quantity"), 0)::text AS sum FROM "inventory_reservations"
      WHERE "productVariantId" = $1::uuid AND "inventoryLocationId" = $2::uuid`,
    [productVariantId, inventoryLocationId],
  );
  return new Decimal(rows[0]?.sum ?? '0');
}

// Suelta todo lo que apartaban estos documentos. Liberar es borrar la fila, no editarla (ver la
// entidad).
export async function releaseReservations(
  manager: EntityManager,
  sourceType: InventorySourceType,
  sourceIds: string[],
): Promise<void> {
  if (sourceIds.length === 0) return;
  const repo = manager.getRepository(InventoryReservation);
  const rows = await repo.find({
    where: { sourceType, sourceId: In(sourceIds) },
    lock: { mode: 'pessimistic_write' },
  });
  await repo.remove(rows);
}
