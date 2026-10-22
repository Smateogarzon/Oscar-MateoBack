import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { Decimal } from 'decimal.js';
import { InjectRepository } from '@nestjs/typeorm';
import type { EntityManager } from 'typeorm';
import { In, Repository } from 'typeorm';
import { RecordStatus } from '../../common/enums/record-status.enum.js';
import { InventoryLocationType } from '../inventory-location/entities/inventory-location-type.enum.js';
import { LocationType } from '../location/entities/location-type.enum.js';
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
  /** Tienda o bodega: lo que está en una tienda se cobra, lo que está en una bodega se pide. */
  locationType: LocationType;
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

  // El cajón del que sale una línea de venta (devuelve su id): SIEMPRE el de la tienda que vende.
  // Antes podía ser cualquiera de la empresa —el que más tuviera—, hasta el de otra tienda, porque
  // el punto de venta no tenía existencia propia y todo viajaba desde una bodega satélite. Hoy la
  // tienda SÍ tiene existencia (todo lo suyo es mostrador), así que lo que no está en la tienda no
  // se cobra: se pide a bodega y se cobra cuando llega.
  //
  // Se mira lo DISPONIBLE (lo que hay menos lo ya apartado para otra venta en curso), no lo que hay
  // físicamente: si el último par ya lo tomó otro vendedor, sigue en la tienda pero no se puede
  // prometer otra vez. Una tienda con más de un cajón no suma: una línea sale de UN cajón, así que
  // manda el que más tenga.
  async findStockLocationForSale(
    manager: EntityManager,
    companyId: string,
    productVariantId: string,
    quantity: Decimal,
    // La tienda donde se vende: ya no es opcional, es justamente lo que acota la búsqueda.
    storeId: string,
  ): Promise<string> {
    const candidates = (await this.stockAvailability(manager, companyId, productVariantId)).filter(
      (row) => row.locationId === storeId,
    );
    if (candidates.length === 0) {
      throw new NotFoundException('Esta referencia no está en la tienda: pídela a bodega y se cobra cuando llegue');
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
          : `La tienda tiene ${best.available.toFixed(2)} de esta referencia y se pidieron ${quantity.toFixed(2)}: lo que falta se pide a bodega`,
      );
    }
    return best.inventoryLocationId;
  }

  // Lo que el selector de Ventas necesita saber de cada variante, con la tienda a la vista:
  //   availableQuantity  lo que se puede COBRAR ya: lo disponible en el cajón de esa tienda
  //   warehouseQuantity  lo que se puede PEDIR: lo disponible en la bodega que más tenga
  // Son dos cosas distintas desde que una venta solo sale de la tienda (ver
  // findStockLocationForSale): lo que está en bodega no se cobra, se pide, y el selector lo ofrece
  // con ese botón en vez de dejar agregarlo al carrito.
  //
  // En los dos casos manda el cajón que más tenga y no la suma: ni una línea de venta ni una de
  // pedido se parten entre dos cajones (ver `planBySource` en los pedidos).
  async findSellableStock(companyId: string, storeId?: string): Promise<SellableStockObjectType[]> {
    const rows = await this.stockAvailability(this.inventoryBalanceRepository.manager, companyId);

    const keepHighest = (into: Map<string, Decimal>, productVariantId: string, available: Decimal) => {
      const current = into.get(productVariantId);
      if (!current || available.greaterThan(current)) into.set(productVariantId, available);
    };

    const store = new Map<string, Decimal>();
    const warehouse = new Map<string, Decimal>();
    for (const row of rows) {
      if (storeId && row.locationId === storeId) keepHighest(store, row.productVariantId, row.available);
      else if (row.locationType === LocationType.WAREHOUSE) keepHighest(warehouse, row.productVariantId, row.available);
    }

    const zero = new Decimal(0);
    return [...new Set([...store.keys(), ...warehouse.keys()])]
      .map((productVariantId) => ({
        productVariantId,
        availableQuantity: store.get(productVariantId) ?? zero,
        warehouseQuantity: warehouse.get(productVariantId) ?? zero,
      }))
      .filter((row) => row.availableQuantity.greaterThan(0) || row.warehouseQuantity.greaterThan(0));
  }

  /**
   * Lo disponible de cada variante en el cajón de una tienda, para saber qué puede cobrar ya y qué
   * tiene que pedir. Manda el cajón que más tenga, igual que en una venta: una línea sale de uno
   * solo. Las variantes sin nada disponible ahí no vienen en el mapa.
   */
  async availableInStore(
    manager: EntityManager,
    companyId: string,
    storeId: string,
    productVariantIds: readonly string[],
  ): Promise<Map<string, Decimal>> {
    if (productVariantIds.length === 0) return new Map();
    const wanted = new Set(productVariantIds);
    const available = new Map<string, Decimal>();
    for (const row of await this.stockAvailability(manager, companyId)) {
      if (row.locationId !== storeId || !wanted.has(row.productVariantId)) continue;
      const current = available.get(row.productVariantId);
      if (!current || row.available.greaterThan(current)) available.set(row.productVariantId, row.available);
    }
    return available;
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
    const rows: {
      productVariantId: string;
      inventoryLocationId: string;
      locationId: string;
      locationType: LocationType;
      quantity: string;
      available: string;
    }[] = await manager.query(
      `SELECT b."productVariantId" AS "productVariantId", b."inventoryLocationId" AS "inventoryLocationId",
                l."locationId" AS "locationId", loc.type AS "locationType",
                b.quantity::text AS "quantity", (b.quantity - COALESCE(r.reserved, 0))::text AS "available"
           FROM inventory_balances b
           JOIN inventory_locations l ON l.id = b."inventoryLocationId"
           JOIN locations loc ON loc.id = l."locationId"
           LEFT JOIN (SELECT res."productVariantId", res."inventoryLocationId", SUM(res.quantity) AS reserved
                        FROM inventory_reservations res
                        JOIN inventory_locations rl ON rl.id = res."inventoryLocationId"
                       WHERE rl."companyId" = $1::uuid
                       GROUP BY res."productVariantId", res."inventoryLocationId") r
             ON r."productVariantId" = b."productVariantId" AND r."inventoryLocationId" = b."inventoryLocationId"
          WHERE l."companyId" = $1::uuid
            AND l.type = $2::inventory_location_type
            AND l.status = $3::record_status
            AND loc.status = $3::record_status
            AND b.quantity > 0
            ${productVariantId ? 'AND b."productVariantId" = $4::uuid' : ''}
          ORDER BY (b.quantity - COALESCE(r.reserved, 0)) DESC`,
      [companyId, InventoryLocationType.STOCK, RecordStatus.ACTIVE, ...(productVariantId ? [productVariantId] : [])],
    );
    return rows.map((row) => ({
      productVariantId: row.productVariantId,
      inventoryLocationId: row.inventoryLocationId,
      locationId: row.locationId,
      locationType: row.locationType,
      quantity: new Decimal(row.quantity),
      available: new Decimal(row.available),
    }));
  }
}
