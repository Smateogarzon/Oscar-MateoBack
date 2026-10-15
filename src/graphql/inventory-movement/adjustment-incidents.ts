import type { EntityManager } from 'typeorm';
import { IncidentStatus } from '../incident/entities/incident-status.enum.js';
import { IncidentType } from '../incident/entities/incident-type.enum.js';
import { Incident } from '../incident/entities/incident.entity.js';
import { InventoryLocation } from '../inventory-location/entities/inventory-location.entity.js';
import { ProductVariant } from '../product-variant/entities/product-variant.entity.js';
import { InventoryMovementType } from './entities/inventory-movement-type.enum.js';
import { InventorySourceType } from './entities/inventory-source-type.enum.js';
import type { InventoryMovement } from './entities/inventory-movement.entity.js';

// Un ajuste de stock a mano siempre es una novedad: la existencia cambió sin que ningún documento
// (una venta, una compra, un traslado) lo explique, y alguien tiene que mirar por qué. Por eso cada
// ajuste de los que hace la pantalla "Ajustar stock" abre, en la MISMA transacción que lo aplica,
// una novedad OPEN a nombre de quien lo registró, apuntando al movimiento del kárdex.
//
// Qué NO abre novedad:
//   INITIAL_STOCK   el cargue inicial de una variante: no hay descuadre, es la primera existencia.
//   las bajas (WriteOffService.approve) y cualquier otro flujo que llame a `recordInTransaction`
//                   desde su propia transacción: ese documento ya es la constancia, y repetirla
//                   aquí sería una novedad por cada baja aprobada.

const ENTITY_TYPE = 'INVENTORY_MOVEMENT';
const MAX_TITLE = 150;
const MAX_DESCRIPTION = 500;

/** Si este movimiento es uno de los ajustes a mano que deben dejar novedad. */
export function isManualAdjustment(type: InventoryMovementType, sourceType: InventorySourceType): boolean {
  return (
    sourceType === InventorySourceType.MANUAL_ADJUSTMENT &&
    (type === InventoryMovementType.ADJUSTMENT || type === InventoryMovementType.DAMAGE)
  );
}

// Mercancía dañada es DAMAGE; lo demás es existencia que apareció o desapareció sin registro, que
// es justo lo que dicen UNREGISTERED_ENTRY y UNREGISTERED_EXIT.
function incidentType(movement: InventoryMovement): IncidentType {
  if (movement.type === InventoryMovementType.DAMAGE) return IncidentType.DAMAGE;
  return movement.toLocationId ? IncidentType.UNREGISTERED_ENTRY : IncidentType.UNREGISTERED_EXIT;
}

export async function openAdjustmentIncident(
  manager: EntityManager,
  movement: InventoryMovement,
): Promise<Incident> {
  // El lugar del ajuste: el destino en una entrada, el origen en una salida. La novedad guarda la
  // SEDE (igual que las demás), no el cajón de inventario.
  const inventoryLocationId = movement.toLocationId ?? movement.fromLocationId;
  const [variant, inventoryLocation] = await Promise.all([
    manager.getRepository(ProductVariant).findOne({
      where: { id: movement.productVariantId },
      relations: { product: true },
    }),
    inventoryLocationId
      ? manager.getRepository(InventoryLocation).findOne({
          where: { id: inventoryLocationId },
          relations: { location: true },
        })
      : null,
  ]);

  const entrada = !!movement.toLocationId;
  const what = variant ? `${variant.product?.name ?? 'Producto'} (${variant.sku})` : 'una variante';
  const where = inventoryLocation?.location?.name ? ` en ${inventoryLocation.location.name}` : '';
  const title = `Ajuste de stock: ${entrada ? 'entrada' : 'salida'} de ${movement.quantity.toFixed(2)} un. de ${what}${where}`;
  const description = [
    `Ajuste manual de ${movement.quantity.toFixed(2)} un. (${entrada ? 'entrada' : 'salida'}${movement.type === InventoryMovementType.DAMAGE ? ', mercancía dañada' : ''}).`,
    movement.notes ? `Detalle: ${movement.notes}` : null,
  ]
    .filter(Boolean)
    .join(' ');

  const repo = manager.getRepository(Incident);
  return repo.save(
    repo.create({
      companyId: movement.companyId,
      type: incidentType(movement),
      status: IncidentStatus.OPEN,
      title: title.slice(0, MAX_TITLE),
      description: description.slice(0, MAX_DESCRIPTION),
      entityType: ENTITY_TYPE,
      entityId: movement.id,
      locationId: inventoryLocation?.locationId ?? null,
      productVariantId: movement.productVariantId,
      reportedBy: movement.createdBy,
      resolvedBy: null,
      resolvedAt: null,
    }),
  );
}
