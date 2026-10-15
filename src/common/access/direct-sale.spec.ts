import { Category } from '../../graphql/category/entities/category.entity.js';
import { Location } from '../../graphql/location/entities/location.entity.js';
import { Product } from '../../graphql/product/entities/product.entity.js';
import { ProductVariant } from '../../graphql/product-variant/entities/product-variant.entity.js';
import { isDirectCategory, isDirectIn, isDirectLine, isDirectStore } from './direct-sale.js';

const COMPANY = 'company-1';
const STORE = 'store-1';

interface Row {
  id: string;
  directSale?: boolean;
  parentId?: string | null;
  productId?: string;
  categoryId?: string;
}

/**
 * Un manager con los cuatro repositorios que mira el helper. Las categorías se pasan como árbol
 * (`parentId`), para poder probar que la marca se hereda hacia abajo.
 */
function createManager(options: {
  store?: Row;
  categories?: Row[];
  variants?: Row[];
  products?: Row[];
}) {
  const find = (rows: Row[] | undefined) =>
    vi.fn(async ({ where }: { where: { id: string; companyId: string } }) =>
      where.companyId === COMPANY ? (rows ?? []).find((row) => row.id === where.id) ?? null : null,
    );
  const repos = new Map<unknown, { findOne: ReturnType<typeof find> }>([
    [Location, { findOne: find(options.store ? [options.store] : []) }],
    [Category, { findOne: find(options.categories) }],
    [ProductVariant, { findOne: find(options.variants) }],
    [Product, { findOne: find(options.products) }],
  ]);
  return { getRepository: (entity: unknown) => repos.get(entity)! } as never;
}

describe('isDirectStore', () => {
  it('la tienda marcada vende directo', async () => {
    const manager = createManager({ store: { id: STORE, directSale: true } });
    await expect(isDirectStore(manager, COMPANY, STORE)).resolves.toBe(true);
  });

  it('una sede sin marcar, no; y una que no existe tampoco', async () => {
    await expect(isDirectStore(createManager({ store: { id: STORE, directSale: false } }), COMPANY, STORE)).resolves.toBe(false);
    await expect(isDirectStore(createManager({}), COMPANY, STORE)).resolves.toBe(false);
  });
});

describe('isDirectCategory', () => {
  // Ropa (marcada) → Camisas → Manga corta: la marca de la raíz alcanza a toda la rama.
  const tree: Row[] = [
    { id: 'ropa', directSale: true, parentId: null },
    { id: 'camisas', directSale: false, parentId: 'ropa' },
    { id: 'manga-corta', directSale: false, parentId: 'camisas' },
    { id: 'calzado', directSale: false, parentId: null },
    { id: 'tenis', directSale: false, parentId: 'calzado' },
  ];

  it('la categoría marcada lo es', async () => {
    await expect(isDirectCategory(createManager({ categories: tree }), COMPANY, 'ropa')).resolves.toBe(true);
  });

  it('se hereda hacia abajo, cuantos niveles haya', async () => {
    const manager = createManager({ categories: tree });
    await expect(isDirectCategory(manager, COMPANY, 'camisas')).resolves.toBe(true);
    await expect(isDirectCategory(manager, COMPANY, 'manga-corta')).resolves.toBe(true);
  });

  it('una rama sin marcar no lo es', async () => {
    const manager = createManager({ categories: tree });
    await expect(isDirectCategory(manager, COMPANY, 'calzado')).resolves.toBe(false);
    await expect(isDirectCategory(manager, COMPANY, 'tenis')).resolves.toBe(false);
  });

  it('un ciclo por un dato corrupto no cuelga la petición', async () => {
    const cycle: Row[] = [
      { id: 'a', directSale: false, parentId: 'b' },
      { id: 'b', directSale: false, parentId: 'a' },
    ];
    await expect(isDirectCategory(createManager({ categories: cycle }), COMPANY, 'a')).resolves.toBe(false);
  });
});

describe('isDirectLine', () => {
  const variants: Row[] = [{ id: 'variant-1', productId: 'product-1' }];
  const shirt: Row[] = [{ id: 'product-1', categoryId: 'ropa' }];
  const shoe: Row[] = [{ id: 'product-1', categoryId: 'calzado' }];
  const categories: Row[] = [
    { id: 'ropa', directSale: true, parentId: null },
    { id: 'calzado', directSale: false, parentId: null },
  ];

  it('basta con que la tienda no tenga corredores', async () => {
    const manager = createManager({ store: { id: STORE, directSale: true }, variants, products: shoe, categories });
    await expect(isDirectLine(manager, COMPANY, STORE, 'variant-1')).resolves.toBe(true);
  });

  it('basta con que la mercancía viva en la tienda, aunque la tienda sí tenga corredores', async () => {
    const manager = createManager({ store: { id: STORE, directSale: false }, variants, products: shirt, categories });
    await expect(isDirectLine(manager, COMPANY, STORE, 'variant-1')).resolves.toBe(true);
  });

  it('el calzado de una tienda con corredores sigue pasando por bodega', async () => {
    const manager = createManager({ store: { id: STORE, directSale: false }, variants, products: shoe, categories });
    await expect(isDirectLine(manager, COMPANY, STORE, 'variant-1')).resolves.toBe(false);
  });
});

describe('isDirectIn', () => {
  it("'all' (tienda sin corredores) alcanza a cualquier variante", () => {
    expect(isDirectIn('all', 'cualquiera')).toBe(true);
  });

  it('con un conjunto, solo las que estén en él', () => {
    const direct = new Set(['variant-1']);
    expect(isDirectIn(direct, 'variant-1')).toBe(true);
    expect(isDirectIn(direct, 'variant-2')).toBe(false);
  });
});
