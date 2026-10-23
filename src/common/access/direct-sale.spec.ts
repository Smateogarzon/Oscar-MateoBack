import { Location } from '../../graphql/location/entities/location.entity.js';
import { isDirectStore } from './direct-sale.js';

const COMPANY = 'company-1';
const STORE = 'store-1';

interface Row {
  id: string;
  directSale?: boolean;
}

/** Un manager con el único repositorio que mira el helper. */
function createManager(store?: Row) {
  const findOne = vi.fn(async ({ where }: { where: { id: string; companyId: string } }) =>
    where.companyId === COMPANY && store && store.id === where.id ? store : null,
  );
  return { getRepository: (entity: unknown) => (entity === Location ? { findOne } : { findOne: vi.fn() }) } as never;
}

describe('isDirectStore', () => {
  it('es la tienda marcada como sin corredores', async () => {
    await expect(isDirectStore(createManager({ id: STORE, directSale: true }), COMPANY, STORE)).resolves.toBe(true);
  });

  it('no lo es la tienda que sí tiene corredores', async () => {
    await expect(isDirectStore(createManager({ id: STORE, directSale: false }), COMPANY, STORE)).resolves.toBe(false);
  });

  it('una sede que no existe, o que es de otra empresa, no lo es', async () => {
    await expect(isDirectStore(createManager(), COMPANY, STORE)).resolves.toBe(false);
    await expect(isDirectStore(createManager({ id: STORE, directSale: true }), 'otra-empresa', STORE)).resolves.toBe(false);
  });
});
