import type { EntityManager } from 'typeorm';
import { Category } from '../../graphql/category/entities/category.entity.js';
import { Location } from '../../graphql/location/entities/location.entity.js';
import { Product } from '../../graphql/product/entities/product.entity.js';
import { ProductVariant } from '../../graphql/product-variant/entities/product-variant.entity.js';

/**
 * Qué se vende directo en caja y qué pasa por bodega y corredor.
 *
 * La empresa vende dos cosas distintas: el calzado vive en una bodega y un corredor lo lleva a la
 * tienda cuando un cliente lo pide (ver internal-order-flow.ts), y la ropa ya está colgada en la
 * tienda. Lo segundo no tiene nada que esperar: se cobra en caja y se descuenta del STOCK de esa
 * misma tienda.
 *
 * Son dos interruptores, y basta con cualquiera de los dos para que una línea sea directa:
 *   `Location.directSale`  la tienda no tiene corredores: todo lo que vende ya está ahí.
 *   `Category.directSale`  esa mercancía vive en la tienda en cualquier tienda (la ropa). Se hereda
 *                          hacia las subcategorías, así marcar "Ropa" alcanza a todo lo de dentro.
 *
 * Hacen falta los dos porque una misma tienda puede vender ambas cosas: ahí la tienda sí tiene
 * corredores (por el calzado) y lo que marca la diferencia es la categoría.
 */

/** ¿Esa tienda vende todo directo en caja? Una sede que no existe no lo es. */
export async function isDirectStore(manager: EntityManager, companyId: string, storeId: string): Promise<boolean> {
  const store = await manager.getRepository(Location).findOne({
    where: { id: storeId, companyId },
    select: { id: true, directSale: true },
  });
  return store?.directSale ?? false;
}

/**
 * ¿La categoría —o alguna por encima de ella— está marcada como directa? Sube por `parentId` hasta
 * la raíz. El árbol lo arma cada empresa y es de pocos niveles; el tope de vueltas está para que un
 * ciclo por un dato corrupto no cuelgue la petición en vez de responder.
 */
export async function isDirectCategory(manager: EntityManager, companyId: string, categoryId: string): Promise<boolean> {
  const repo = manager.getRepository(Category);
  let current: string | null = categoryId;
  for (let depth = 0; current && depth < 20; depth += 1) {
    const category: Pick<Category, 'directSale' | 'parentId'> | null = await repo.findOne({
      where: { id: current, companyId },
      select: { directSale: true, parentId: true },
    });
    if (!category) return false;
    if (category.directSale) return true;
    current = category.parentId;
  }
  return false;
}

/** La categoría del producto de esa variante; `null` si la variante no es de la empresa. */
export async function categoryOfVariant(manager: EntityManager, companyId: string, productVariantId: string): Promise<string | null> {
  const variant = await manager.getRepository(ProductVariant).findOne({
    where: { id: productVariantId, companyId },
    select: { id: true, productId: true },
  });
  if (!variant) return null;
  const product = await manager.getRepository(Product).findOne({
    where: { id: variant.productId, companyId },
    select: { id: true, categoryId: true },
  });
  return product?.categoryId ?? null;
}

/** ¿Esa variante no pasa por corredor en ninguna tienda (por su categoría)? */
export async function isDirectVariant(manager: EntityManager, companyId: string, productVariantId: string): Promise<boolean> {
  const categoryId = await categoryOfVariant(manager, companyId, productVariantId);
  return categoryId !== null && isDirectCategory(manager, companyId, categoryId);
}

/**
 * ¿Esta línea se cobra directo del stock de la tienda? Lo es si la tienda no tiene corredores o si
 * la mercancía vive en la tienda. Las dos preguntas van en paralelo: son independientes.
 */
export async function isDirectLine(
  manager: EntityManager,
  companyId: string,
  storeId: string,
  productVariantId: string,
): Promise<boolean> {
  const [store, variant] = await Promise.all([
    isDirectStore(manager, companyId, storeId),
    isDirectVariant(manager, companyId, productVariantId),
  ]);
  return store || variant;
}

/**
 * Qué se vende directo en una tienda, para resolverlo de una sola vez en vez de variante por
 * variante: `'all'` si la tienda no tiene corredores (ahí todo es directo), o el conjunto de
 * variantes cuya categoría —o alguna por encima— está marcada como directa.
 *
 * La herencia de la marca se recorre en la base (`WITH RECURSIVE`): marcar "Ropa" alcanza a sus
 * subcategorías sin traerse el árbol entero a memoria ni hacer una consulta por nivel.
 */
export async function directVariantsOf(
  manager: EntityManager,
  companyId: string,
  storeId: string,
): Promise<Set<string> | 'all'> {
  if (await isDirectStore(manager, companyId, storeId)) return 'all';

  const rows: { productVariantId: string }[] = await manager.query(
    `WITH RECURSIVE direct_categories AS (
         SELECT c."id" FROM "categories" c WHERE c."companyId" = $1::uuid AND c."directSale" = true
       UNION
         SELECT child."id" FROM "categories" child
           JOIN direct_categories parent ON child."parentId" = parent."id"
          WHERE child."companyId" = $1::uuid
     )
     SELECT pv."id" AS "productVariantId"
       FROM "product_variants" pv
       JOIN "products" p ON p."id" = pv."productId"
      WHERE pv."companyId" = $1::uuid
        AND p."categoryId" IN (SELECT "id" FROM direct_categories)`,
    [companyId],
  );
  return new Set(rows.map((row) => row.productVariantId));
}

/** ¿Esa variante se vende directo en esa tienda, según lo que devolvió `directVariantsOf`? */
export const isDirectIn = (direct: Set<string> | 'all', productVariantId: string): boolean =>
  direct === 'all' || direct.has(productVariantId);
