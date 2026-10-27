import { describe, expect, it } from 'vitest';
import { InternalOrderStatus as S } from './entities/internal-order-status.enum.js';
import { InternalOrderType } from './entities/internal-order-type.enum.js';
import { FINAL_STATUSES, FLOWS, INITIAL_STATUS, SERVICE_STATUSES } from './internal-order-flow.js';

/**
 * El guardián de las máquinas de estado: ninguna orden puede quedar en un estado del que nadie
 * pueda sacarla.
 *
 * Lo escribimos porque pasó: SO-000008 quedó congelada en RETURN_REQUESTED esperando una devolución
 * que nadie iba a crear —ni el vendedor, ni bodega, ni el administrador tenían un paso desde ahí—.
 * La regla que esta prueba impone es simple: todo estado al que una orden puede llegar o es final,
 * o tiene un paso en FLOWS, o está en SERVICE_STATUSES explicando quién lo resuelve. Agregar un
 * estado nuevo sin contestar esa pregunta rompe la prueba.
 */

const TYPES = Object.values(InternalOrderType);

/** Todo estado al que una orden de ese tipo puede llegar: con el que nace, al que lleva un paso de
 * la tabla, y los que pone el servicio por fuera de ella. */
const reachable = (type: InternalOrderType): S[] => {
  const statuses = new Set<S>([INITIAL_STATUS[type]]);
  for (const step of FLOWS[type]) statuses.add(step.to);
  for (const status of Object.keys(SERVICE_STATUSES[type]) as S[]) statuses.add(status);
  return [...statuses];
};

const hasManualStep = (type: InternalOrderType, status: S): boolean => FLOWS[type].some((step) => step.from === status);

describe('ningún estado sin salida', () => {
  for (const type of TYPES) {
    it(`${type}: todo estado no final se puede cerrar o avanzar`, () => {
      const stuck = reachable(type).filter(
        (status) =>
          !FINAL_STATUSES.includes(status) && !hasManualStep(type, status) && !SERVICE_STATUSES[type][status],
      );
      expect(stuck, `${type}: estos estados no tienen salida ni explicación en SERVICE_STATUSES`).toEqual([]);
    });

    it(`${type}: lo que resuelve el servicio dice quién lo resuelve`, () => {
      for (const [status, who] of Object.entries(SERVICE_STATUSES[type])) {
        expect((who ?? '').trim().length, `${type}/${status} necesita decir quién lo saca de ese estado`).toBeGreaterThan(20);
      }
    });

    it(`${type}: ningún paso sale de un estado final`, () => {
      const fromFinal = FLOWS[type].filter((step) => FINAL_STATUSES.includes(step.from));
      expect(fromFinal).toEqual([]);
    });
  }

  it('una orden de venta que quedó esperando una devolución la puede cerrar el administrador', () => {
    const rescue = FLOWS[InternalOrderType.SO].find((step) => step.from === S.RETURN_REQUESTED);
    expect(rescue?.to).toBe(S.RETURNED);
    expect(rescue?.actor).toBe('ADMIN');
  });
});
