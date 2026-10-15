import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { Decimal } from 'decimal.js';
import { InjectRepository } from '@nestjs/typeorm';
import type { EntityManager } from 'typeorm';
import { In, Repository } from 'typeorm';
import { directVariantsOf, isDirectIn } from '../../common/access/direct-sale.js';
import { RecordStatus } from '../../common/enums/record-status.enum.js';
import { InventoryLocationType } from '../inventory-location/entities/inventory-location-type.enum.js';
import type { SellableStockObjectType } from './dto/sellable-stock.object-type.js';
import { InventoryBalance } from './entities/inventory-balance.entity.js';

export interface InventoryBalanceFilter {
  productVariantId?: string;
  inventoryLocationId?: string;
  /** Las sedes cuyo inventario puede ver quien consulta, o `null` si las ve todas (ver
   * `visibleLocationIds`). Un arreglo vacío no devuelve nada: no tiene ninguna asignada. */
  locationIds?: string[] | null;
}

// Lo que hay y lo disponible de una variante en una bodega STOCK (ver `stockAvailability`).
interface StockAvailability {
  productVariantId: string;
  inventoryLocationId: string;
  /** La sede a la que pertenece ese cajón: con esto se distingue el stock de la tienda que vende. */
  locationId: string;
  quantity: Decimal;
  available: Decimal;
}

// La existencia (`quantity`) solo la cambia InventoryMovementService (ver la entidad); aquí solo se
// edita el mínimo (`minStock`), que no mueve stock. La empresa no vive en esta tabla; se llega a ella a través de la variante, que sí es de una sola empresa.
@Injectable()
export class InventoryBalanceService {
  constructor(
    @InjectRepository(InventoryBalance)
    private readonly inventoryBalanceRepository: Repository<InventoryBalance>,
  ) {}

  // Las existencias de la empresa, acotadas a las sedes de quien consulta (`locationIds`): un
  // bodeguero ve lo de sus bodegas, no lo de toda la empresa. Los cajones sin sede (la bolsa de un
  // corredor) quedan fuera para todo el que no las vea todas: no son de ninguna bodega suya.
  findAll(companyId: string, filter: InventoryBalanceFilter = {}): Promise<InventoryBalance[]> {
    const { locationIds } = filter;
    if (locationIds?.length === 0) return Promise.resolve([]);
    return this.inventoryBalanceRepository.find({
      where: {
        productVariant: { companyId },
        ...(filter.productVariantId && { productVariantId: filter.productVariantId }),
        ...(filter.inventoryLocationId && { inventoryLocationId: filter.inventoryLocationId }),
        ...(locationIds && { inventoryLocation: { locationId: In(locationIds) } }),
      },
    });
  }

  // Fuera de las sedes de quien consulta la existencia no existe: 404, no 403 (quien no ve una
  // bodega tampoco tiene por qué saber qué hay en ella).
  async findOne(companyId: string, id: string, locationIds?: string[] | null): Promise<InventoryBalance> {
    const balance =
      locationIds?.length === 0
        ? null
        : await this.inventoryBalanceRepository.findOne({
            where: {
              id,
              productVariant: { companyId },
              ...(locationIds && { inventoryLocation: { locationId: In(locationIds) } }),
            },
          });
    if (!balance) throw new NotFoundException(`Existencia ${id} no encontrada`);
    return balance;
  }

  // Fija o quita el mínimo de una existencia sin registrar un movimiento. Un UPDATE de esa sola
  // columna: no pisa la cantidad que un movimiento esté ajustando en paralelo.
  async updateMinStock(companyId: string, id: string, minStock: string, locationIds?: string[] | null): Promise<InventoryBalance> {
    await this.findOne(companyId, id, locationIds);
    await this.inventoryBalanceRepository.update({ id }, { minStock: minStock ? new Decimal(minStock) : null });
    return this.findOne(companyId, id, locationIds);
  }

  // La bodega STOCK de la que sale una línea de venta (devuelve su id): hoy cada referencia vive en
  // una sola bodega satélite (no hay reparto por tienda), así que una venta descuenta de ahí sin
  // importar en qué tienda se hizo — más adelante un corredor la trae físicamente hasta el cliente
  // (ver InventoryLocationType.RUNNER), pero eso es un flujo aparte, todavía por construir.
  // Se mira lo DISPONIBLE (lo que hay menos lo que ya está apartado para otra venta en curso), no lo
  // que hay físicamente: si el último par ya lo tomó otro vendedor, sigue estando en la bodega pero no
  // se puede prometer otra vez.
  // Si la existencia quedara repartida en más de una bodega, se usa la que más disponible tenga; si ni
  // esa alcanza, se rechaza en vez de partir la línea entre varias bodegas.
  async findStockLocationForSale(
    manager: EntityManager,
    companyId: string,
    productVariantId: string,
    quantity: Decimal,
    // La tienda donde se vende, si se sabe: lo que se vende directo (la ropa, o todo en una tienda
    // sin corredores) solo sale del stock de esa tienda, porque no hay quien lo traiga de otra.
    storeId?: string,
  ): Promise<string> {
    const all = await this.stockAvailability(manager, companyId, productVariantId);
    const direct = storeId ? await directVariantsOf(manager, companyId, storeId) : new Set<string>();
    const sellsDirect = isDirectIn(direct, productVariantId);
    const candidates = sellsDirect ? all.filter((row) => row.locationId === storeId) : all;
    if (candidates.length === 0) {
      throw new NotFoundException(
        sellsDirect
          ? 'Esta referencia se vende de lo que hay en la tienda y la tienda no tiene existencia de ella'
          : 'Esta variante no tiene existencia registrada en ninguna bodega',
      );
    }

    const best = candidates[0];
    if (best.available.lessThan(quantity)) {
      // Lo que hay sí alcanzaba: lo que falta está apartado para otra venta en curso. Es la carrera
      // por el último par, y se dice así en vez de "no hay existencia", que mandaría a buscar el
      // problema a la bodega.
      const physical = Decimal.max(...candidates.map((candidate) => candidate.quantity));
      throw new ConflictException(
        physical.greaterThanOrEqualTo(quantity)
          ? `Otro vendedor tiene apartadas esas unidades: quedan ${best.available.toFixed(2)} disponibles de ${physical.toFixed(2)} y se pidieron ${quantity.toFixed(2)}`
          : sellsDirect
            ? `La tienda tiene ${best.available.toFixed(2)} disponibles de esta referencia y se pidieron ${quantity.toFixed(2)}`
            : `No hay suficiente existencia en una sola bodega: la mayor tiene ${best.available.toFixed(2)} disponibles y se pidieron ${quantity.toFixed(2)}`,
      );
    }
    return best.inventoryLocationId;
  }

  // Lo que se puede vender de cada variante de la empresa: lo disponible en la bodega STOCK que más
  // tiene, que es lo máximo que acepta una línea de venta (sale entera de una sola bodega; ver
  // findStockLocationForSale). Con esto el selector de productos de Ventas muestra lo agotado y no
  // deja pedir de más, con la misma cuenta con la que después se aparta, sin repetirla en el cliente.
  //
  // Con `storeId` (la tienda donde se está vendiendo) lo que se vende directo se cuenta DONDE está:
  // la ropa de esa tienda, o todo si la tienda no tiene corredores (ver `directVariantsOf`). Si se
  // contara "la que más tenga", el selector ofrecería la ropa de otra tienda y la venta se iría a
  // descontar de allá, que es justo lo que no puede pasar: nadie la va a traer.
  async findSellableStock(companyId: string, storeId?: string): Promise<SellableStockObjectType[]> {
    const manager = this.inventoryBalanceRepository.manager;
    const rows = await this.stockAvailability(manager, companyId);
    const direct = storeId ? await directVariantsOf(manager, companyId, storeId) : new Set<string>();

    const best = new Map<string, Decimal>();
    for (const row of rows) {
      // Lo directo solo cuenta en la tienda que vende; lo demás, en cualquier bodega.
      if (isDirectIn(direct, row.productVariantId) && row.locationId !== storeId) continue;
      const current = best.get(row.productVariantId);
      if (!current || row.available.greaterThan(current)) best.set(row.productVariantId, row.available);
    }
    return [...best]
      .filter(([, available]) => available.greaterThan(0))
      .map(([productVariantId, availableQuantity]) => ({ productVariantId, availableQuantity }));
  }

  // Lo que hay y lo disponible (lo que hay menos lo apartado) en cada bodega STOCK activa de la
  // empresa, de una variante o de todas, de la que más disponible tiene a la que menos. Es la misma
  // cuenta que hacen, con la balanza bloqueada, InventoryReservationService.reserveInTransaction e
  // InventoryMovementService.recordInTransaction (con `reservedQuantity`); aquí va en una sola
  // consulta para elegir bodega y para mostrar lo vendible.
  private async stockAvailability(
    manager: EntityManager,
    companyId: string,
    productVariantId?: string,
  ): Promise<StockAvailability[]> {
    const rows: { productVariantId: string; inventoryLocationId: string; locationId: string; quantity: string; available: string }[] =
      await manager.query(
        `SELECT b."productVariantId" AS "productVariantId", b."inventoryLocationId" AS "inventoryLocationId",
                l."locationId" AS "locationId",
                b.quantity::text AS "quantity", (b.quantity - COALESCE(r.reserved, 0))::text AS "available"
           FROM inventory_balances b
           JOIN inventory_locations l ON l.id = b."inventoryLocationId"
           LEFT JOIN (SELECT res."productVariantId", res."inventoryLocationId", SUM(res.quantity) AS reserved
                        FROM inventory_reservations res
                        JOIN inventory_locations rl ON rl.id = res."inventoryLocationId"
                       WHERE rl."companyId" = $1::uuid
                       GROUP BY res."productVariantId", res."inventoryLocationId") r
             ON r."productVariantId" = b."productVariantId" AND r."inventoryLocationId" = b."inventoryLocationId"
          WHERE l."companyId" = $1::uuid
            AND l.type = $2::inventory_location_type
            AND l.status = $3::record_status
            AND b.quantity > 0
            ${productVariantId ? 'AND b."productVariantId" = $4::uuid' : ''}
          ORDER BY (b.quantity - COALESCE(r.reserved, 0)) DESC`,
        [companyId, InventoryLocationType.STOCK, RecordStatus.ACTIVE, ...(productVariantId ? [productVariantId] : [])],
      );
    return rows.map((row) => ({
      productVariantId: row.productVariantId,
      inventoryLocationId: row.inventoryLocationId,
      locationId: row.locationId,
      quantity: new Decimal(row.quantity),
      available: new Decimal(row.available),
    }));
  }
}
