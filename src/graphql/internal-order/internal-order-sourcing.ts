import { Decimal } from 'decimal.js';

/**
 * De qué bodega sale cada referencia de un pedido de venta. El vendedor ya no elige: pide lo que el
 * cliente quiere y el sistema reparte.
 *
 * La regla, acordada con el usuario (2026-10-15): una línea no se parte entre bodegas —si una
 * referencia está repartida, nadie puede traer "media línea"—, y si lo pedido no cabe en una sola
 * bodega se crea una orden por bodega. Cada orden es entonces un viaje real de un corredor.
 *
 * Se arman los menos grupos posibles: cada vuelta se queda con la bodega que cubre más de lo que
 * falta, se le asignan esas líneas y se repite con el resto. Así un pedido que una bodega puede
 * surtir entero sigue siendo una sola orden, y uno repartido se parte en las menos órdenes que
 * alcancen. El empate se rompe por nombre de bodega, para que el mismo pedido reparta siempre igual.
 */

/** Lo disponible (lo que hay menos lo apartado) de una variante en una bodega. */
export interface SourceAvailability {
  productVariantId: string;
  locationId: string;
  locationName: string;
  available: Decimal;
}

/** Lo mínimo que necesita saber el reparto de una línea del pedido. */
export interface SourceableLine {
  productVariantId: string;
  quantity: Decimal;
}

/** Las líneas que salen de una misma bodega: una orden. */
export interface SourceGroup<L> {
  locationId: string;
  locationName: string;
  lines: L[];
}

export interface SourcePlan<L> {
  /** Un grupo por bodega, el que más líneas cubre primero. */
  groups: SourceGroup<L>[];
  /** Lo que no cabe entero en ninguna bodega: no hay de dónde traerlo. */
  missing: L[];
}

/** Lo disponible de cada variante en cada bodega, indexado para preguntarle línea por línea. */
function availabilityIndex(availability: readonly SourceAvailability[]): Map<string, Map<string, Decimal>> {
  const byLocation = new Map<string, Map<string, Decimal>>();
  for (const row of availability) {
    const variants = byLocation.get(row.locationId) ?? new Map<string, Decimal>();
    // La misma variante puede venir en varias filas de una sede (varios cajones STOCK): suman.
    variants.set(row.productVariantId, (variants.get(row.productVariantId) ?? new Decimal(0)).plus(row.available));
    byLocation.set(row.locationId, variants);
  }
  return byLocation;
}

export function planBySource<L extends SourceableLine>(
  lines: readonly L[],
  availability: readonly SourceAvailability[],
): SourcePlan<L> {
  const byLocation = availabilityIndex(availability);
  const names = new Map(availability.map((row) => [row.locationId, row.locationName]));
  const covers = (locationId: string, line: L): boolean =>
    (byLocation.get(locationId)?.get(line.productVariantId) ?? new Decimal(0)).greaterThanOrEqualTo(line.quantity);

  // Lo que ninguna bodega tiene entero se aparta antes: no compite por entrar en un grupo.
  const missing = lines.filter((line) => ![...byLocation.keys()].some((locationId) => covers(locationId, line)));
  let pending = lines.filter((line) => !missing.includes(line));

  const groups: SourceGroup<L>[] = [];
  while (pending.length > 0) {
    const best = [...byLocation.keys()]
      .map((locationId) => ({ locationId, lines: pending.filter((line) => covers(locationId, line)) }))
      .filter((candidate) => candidate.lines.length > 0)
      .sort(
        (a, b) =>
          b.lines.length - a.lines.length ||
          (names.get(a.locationId) ?? '').localeCompare(names.get(b.locationId) ?? '', 'es') ||
          a.locationId.localeCompare(b.locationId),
      )[0];
    // No puede faltar: todo lo que sigue pendiente lo cubre al menos una bodega (`missing` ya salió).
    if (!best) break;
    groups.push({ locationId: best.locationId, locationName: names.get(best.locationId) ?? '', lines: best.lines });
    pending = pending.filter((line) => !best.lines.includes(line));
  }

  return { groups, missing };
}
