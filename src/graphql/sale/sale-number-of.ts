import type { EntityManager } from 'typeorm';
import { Sale } from './entities/sale.entity.js';

// El número de la venta de un documento que cuelga de ella (una solicitud de descuento, una
// devolución), para mostrarlo en la lista sin pedir todas las ventas: null mientras la venta es un
// borrador (todavía no tiene número). Las listas ya traen la venta cargada; un documento suelto (el
// resultado de una mutación) la busca aquí.
export async function loadSaleNumber(
  reader: Pick<EntityManager, 'getRepository'>,
  document: { sale?: Pick<Sale, 'saleNumber'> | null; saleId: string },
): Promise<string | null> {
  if (document.sale) return document.sale.saleNumber;
  const sale = await reader
    .getRepository(Sale)
    .findOne({ where: { id: document.saleId }, select: { id: true, saleNumber: true } });
  return sale?.saleNumber ?? null;
}
