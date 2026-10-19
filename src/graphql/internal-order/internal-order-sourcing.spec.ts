import { Decimal } from 'decimal.js';
import { describe, expect, it } from 'vitest';
import { planBySource, type SourceAvailability } from './internal-order-sourcing.js';

const line = (productVariantId: string, quantity: number) => ({ productVariantId, quantity: new Decimal(quantity) });

/** Lo disponible de una variante en una bodega. */
const at = (locationId: string, productVariantId: string, available: number): SourceAvailability => ({
  productVariantId,
  locationId,
  locationName: locationId === 'norte' ? 'Bodega Norte' : locationId === 'sur' ? 'Bodega Sur' : locationId,
  available: new Decimal(available),
});

describe('de qué bodega sale cada línea de un pedido', () => {
  it('una sola orden cuando una bodega tiene todo', () => {
    const plan = planBySource([line('a', 2), line('b', 1)], [at('norte', 'a', 5), at('norte', 'b', 3), at('sur', 'a', 1)]);
    expect(plan.missing).toEqual([]);
    expect(plan.groups).toHaveLength(1);
    expect(plan.groups[0].locationId).toBe('norte');
    expect(plan.groups[0].lines.map((item) => item.productVariantId)).toEqual(['a', 'b']);
  });

  it('una orden por bodega cuando lo pedido está repartido', () => {
    const plan = planBySource([line('a', 2), line('b', 1)], [at('norte', 'a', 2), at('sur', 'b', 1)]);
    expect(plan.missing).toEqual([]);
    expect(plan.groups).toHaveLength(2);
    expect(plan.groups.map((group) => [group.locationId, group.lines.map((item) => item.productVariantId)])).toEqual([
      ['norte', ['a']],
      ['sur', ['b']],
    ]);
  });

  it('las menos órdenes posibles: la bodega que cubre más va primero', () => {
    // Norte tiene a y b; Sur solo c. Dos órdenes, no tres.
    const plan = planBySource(
      [line('a', 1), line('b', 1), line('c', 1)],
      [at('norte', 'a', 1), at('norte', 'b', 1), at('sur', 'b', 9), at('sur', 'c', 1)],
    );
    expect(plan.groups).toHaveLength(2);
    expect(plan.groups[0].lines.map((item) => item.productVariantId)).toEqual(['a', 'b']);
    expect(plan.groups[1].lines.map((item) => item.productVariantId)).toEqual(['c']);
  });

  it('una línea no se parte entre dos bodegas: si no cabe entera, falta', () => {
    // Entre las dos hay 3, pero ninguna tiene las 3 de una línea.
    const plan = planBySource([line('a', 3)], [at('norte', 'a', 2), at('sur', 'a', 1)]);
    expect(plan.groups).toEqual([]);
    expect(plan.missing.map((item) => item.productVariantId)).toEqual(['a']);
  });

  it('lo que falta no impide pedir el resto', () => {
    const plan = planBySource([line('a', 1), line('b', 1)], [at('norte', 'a', 1)]);
    expect(plan.groups).toHaveLength(1);
    expect(plan.groups[0].lines.map((item) => item.productVariantId)).toEqual(['a']);
    expect(plan.missing.map((item) => item.productVariantId)).toEqual(['b']);
  });

  it('suma los cajones de una misma bodega', () => {
    const plan = planBySource([line('a', 3)], [at('norte', 'a', 2), at('norte', 'a', 1)]);
    expect(plan.missing).toEqual([]);
    expect(plan.groups).toHaveLength(1);
  });

  it('sin existencia en ninguna bodega, todo falta', () => {
    const plan = planBySource([line('a', 1)], []);
    expect(plan.groups).toEqual([]);
    expect(plan.missing).toHaveLength(1);
  });

  it('el empate se rompe por nombre, así el mismo pedido reparte siempre igual', () => {
    const availability = [at('sur', 'a', 5), at('norte', 'a', 5)];
    expect(planBySource([line('a', 1)], availability).groups[0].locationId).toBe('norte');
    expect(planBySource([line('a', 1)], [...availability].reverse()).groups[0].locationId).toBe('norte');
  });
});
