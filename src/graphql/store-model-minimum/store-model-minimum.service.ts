import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Decimal } from 'decimal.js';
import { DataSource, EntityManager, In, Repository } from 'typeorm';
import { RecordStatus } from '../../common/enums/record-status.enum.js';
import { NOT_ON_THE_WAY_STATUSES } from '../internal-order/internal-order-flow.js';
import { InventoryLocationType } from '../inventory-location/entities/inventory-location-type.enum.js';
import { LocationType } from '../location/entities/location-type.enum.js';
import { Location } from '../location/entities/location.entity.js';
import { ProductVariant } from '../product-variant/entities/product-variant.entity.js';
import { SetStoreModelMinimumInput } from './dto/set-store-model-minimum.input.js';
import { StoreRestockSuggestionObjectType } from './dto/store-restock-suggestion.object-type.js';
import { StoreModelMinimum } from './entities/store-model-minimum.entity.js';

export interface StoreModelMinimumFilter {
  locationId?: string;
  /** Las sedes de quien consulta, o `null` si las ve todas (ver `visibleLocationIds`). */
  locationIds?: string[] | null;
}

/**
 * Los mínimos de mostrador por modelo (ver la entidad) y la vista de "qué pedir" que sale de ellos.
 *
 * Lo que decide si hay que surtir es el stock VENDIBLE, no lo que hay: un par apartado para un
 * cliente o esperando en el cajón de devoluciones ocupa lugar en la tienda pero no se le puede
 * vender a nadie más. Y lo que ya viene en camino se descuenta aparte, para no pedir dos veces lo
 * mismo mientras un corredor lo trae.
 */
@Injectable()
export class StoreModelMinimumService {
  constructor(
    @InjectRepository(StoreModelMinimum)
    private readonly storeModelMinimumRepository: Repository<StoreModelMinimum>,
    private readonly dataSource: DataSource,
  ) {}

  findAll(companyId: string, filter: StoreModelMinimumFilter = {}): Promise<StoreModelMinimum[]> {
    const { locationIds } = filter;
    // Pedir una sede que no es suya no devuelve las suyas: no devuelve nada.
    const scoped = locationIds && filter.locationId && !locationIds.includes(filter.locationId);
    if (scoped || locationIds?.length === 0) return Promise.resolve([]);
    return this.storeModelMinimumRepository.find({
      where: {
        companyId,
        ...(filter.locationId ? { locationId: filter.locationId } : locationIds && { locationId: In(locationIds) }),
      },
      order: { createdAt: 'ASC' },
    });
  }

  /** Fija el mínimo de un modelo en una tienda, o lo quita si viene vacío. */
  async set(
    companyId: string,
    input: SetStoreModelMinimumInput,
    locationIds?: string[] | null,
  ): Promise<StoreModelMinimum | null> {
    if (locationIds && !locationIds.includes(input.locationId)) {
      throw new ForbiddenException('No tienes asignada esa tienda');
    }
    return this.dataSource.transaction(async (manager) => {
      await this.assertStore(manager, companyId, input.locationId);
      await this.assertModel(manager, companyId, input.productId, input.colorId);
      return this.apply(manager, companyId, input.locationId, {
        productId: input.productId,
        colorId: input.colorId,
        minQuantity: input.minQuantity,
      });
    });
  }

  /**
   * El mínimo que trae un traslado, aplicado en la misma transacción que crea la orden: la línea
   * dice cuánto debe haber de ese modelo en la tienda destino, y eso queda fijado desde ya. No se
   * espera a que la orden llegue a propósito — "qué pedir" descuenta lo que viene en camino, así
   * que un mínimo recién puesto no hace pedir dos veces lo mismo.
   *
   * `minimums` va por variante porque es lo que trae la línea del traslado; aquí se resuelve a qué
   * modelo (producto + color) pertenece cada una. Dos tallas del mismo modelo con mínimos distintos
   * no se suman: gana la última, que es lo que escribió quien armó el traslado.
   */
  async applyFromVariants(
    manager: EntityManager,
    companyId: string,
    storeId: string,
    minimums: ReadonlyMap<string, string>,
  ): Promise<void> {
    if (minimums.size === 0) return;
    await this.assertStore(manager, companyId, storeId);
    const variants = await manager.getRepository(ProductVariant).find({
      where: { id: In([...minimums.keys()]), companyId },
      select: { id: true, productId: true, colorId: true },
    });
    for (const variant of variants) {
      await this.apply(manager, companyId, storeId, {
        productId: variant.productId,
        colorId: variant.colorId,
        minQuantity: minimums.get(variant.id)!,
      });
    }
  }

  // El upsert en una sola sentencia (ON CONFLICT), no leer-y-guardar: dos traslados del mismo modelo
  // a la misma tienda a la vez chocarían contra el índice único y uno de los dos se caería entero.
  private async apply(
    manager: EntityManager,
    companyId: string,
    locationId: string,
    model: { productId: string; colorId: string; minQuantity: string },
  ): Promise<StoreModelMinimum | null> {
    const repo = manager.getRepository(StoreModelMinimum);
    const where = { companyId, locationId, productId: model.productId, colorId: model.colorId };

    if (!model.minQuantity) {
      await repo.delete(where);
      return null;
    }

    const minQuantity = new Decimal(model.minQuantity);
    if (minQuantity.lessThanOrEqualTo(0)) {
      throw new BadRequestException('El mínimo debe ser mayor que cero, o vacío para quitarlo');
    }
    await repo.upsert(
      { ...where, minQuantity },
      { conflictPaths: ['companyId', 'locationId', 'productId', 'colorId'] },
    );
    return repo.findOneBy(where);
  }

  /**
   * Qué pedir: los modelos de una tienda cuyo stock vendible está por debajo de su mínimo, con lo
   * que ya viene en camino descontado. Sale de una sola consulta porque son tres cuentas sobre las
   * mismas filas (existencia, apartado y tránsito) y partirlas en tres viajes a la base solo daría
   * números de momentos distintos.
   */
  async findRestockSuggestions(
    companyId: string,
    filter: StoreModelMinimumFilter = {},
  ): Promise<StoreRestockSuggestionObjectType[]> {
    const { locationIds } = filter;
    const scoped = locationIds && filter.locationId && !locationIds.includes(filter.locationId);
    if (scoped || locationIds?.length === 0) return [];

    const params: unknown[] = [companyId, [...NOT_ON_THE_WAY_STATUSES], InventoryLocationType.STOCK, RecordStatus.ACTIVE];
    let scope = '';
    if (filter.locationId) {
      params.push(filter.locationId);
      scope = ` AND m."locationId" = $${params.length}::uuid`;
    } else if (locationIds) {
      params.push(locationIds);
      scope = ` AND m."locationId" = ANY($${params.length}::uuid[])`;
    }

    const rows: {
      locationId: string;
      locationName: string;
      productId: string;
      productName: string;
      reference: string;
      colorId: string;
      colorName: string;
      minQuantity: string;
      quantity: string;
      available: string;
      incoming: string;
    }[] = await this.storeModelMinimumRepository.manager.query(
      `SELECT m."locationId" AS "locationId", loc.name AS "locationName",
              m."productId" AS "productId", p.name AS "productName", p.reference AS "reference",
              m."colorId" AS "colorId", c.name AS "colorName",
              m."minQuantity"::text AS "minQuantity",
              COALESCE(s.quantity, 0)::text AS "quantity",
              COALESCE(s.available, 0)::text AS "available",
              COALESCE(inc.incoming, 0)::text AS "incoming"
         FROM store_model_minimums m
         JOIN locations loc ON loc.id = m."locationId" AND loc.status = $4::record_status
         JOIN products p ON p.id = m."productId" AND p.status = $4::record_status
         JOIN colors c ON c.id = m."colorId"
         LEFT JOIN (
           SELECT il."locationId" AS "locationId", pv."productId" AS "productId", pv."colorId" AS "colorId",
                  SUM(b.quantity) AS quantity,
                  SUM(b.quantity - COALESCE(r.reserved, 0)) AS available
             FROM inventory_balances b
             JOIN inventory_locations il ON il.id = b."inventoryLocationId"
             JOIN product_variants pv ON pv.id = b."productVariantId"
             LEFT JOIN (SELECT res."productVariantId", res."inventoryLocationId", SUM(res.quantity) AS reserved
                          FROM inventory_reservations res
                         GROUP BY res."productVariantId", res."inventoryLocationId") r
               ON r."productVariantId" = b."productVariantId" AND r."inventoryLocationId" = b."inventoryLocationId"
            WHERE il."companyId" = $1::uuid
              AND il.type = $3::inventory_location_type
              AND il.status = $4::record_status
            GROUP BY il."locationId", pv."productId", pv."colorId"
         ) s ON s."locationId" = m."locationId" AND s."productId" = m."productId" AND s."colorId" = m."colorId"
         LEFT JOIN (
           SELECT o."destinationLocationId" AS "locationId", pv."productId" AS "productId", pv."colorId" AS "colorId",
                  SUM(COALESCE(i."foundQuantity", i.quantity)) AS incoming
             FROM internal_orders o
             JOIN internal_order_items i ON i."internalOrderId" = o.id AND i."versionNumber" = o."versionNumber"
             JOIN product_variants pv ON pv.id = i."productVariantId"
            WHERE o."companyId" = $1::uuid
              AND o.type IN ('TR', 'RS')
              AND NOT (o.status = ANY($2::internal_order_status[]))
            GROUP BY o."destinationLocationId", pv."productId", pv."colorId"
         ) inc ON inc."locationId" = m."locationId" AND inc."productId" = m."productId" AND inc."colorId" = m."colorId"
        WHERE m."companyId" = $1::uuid
          AND COALESCE(s.available, 0) < m."minQuantity"
          ${scope}
        ORDER BY loc.name ASC, p.name ASC, c.name ASC`,
      params,
    );

    return rows.map((row) => {
      const minQuantity = new Decimal(row.minQuantity);
      const available = new Decimal(row.available);
      const incoming = new Decimal(row.incoming);
      return {
        locationId: row.locationId,
        locationName: row.locationName,
        productId: row.productId,
        productName: row.productName,
        reference: row.reference,
        colorId: row.colorId,
        colorName: row.colorName,
        minQuantity,
        quantity: new Decimal(row.quantity),
        available,
        incoming,
        missing: Decimal.max(0, minQuantity.minus(available).minus(incoming)),
      };
    });
  }

  private async assertStore(manager: EntityManager, companyId: string, locationId: string): Promise<void> {
    const location = await manager.getRepository(Location).findOneBy({ id: locationId, companyId });
    if (!location) throw new NotFoundException(`Sede ${locationId} no encontrada`);
    if (location.type !== LocationType.STORE) {
      throw new BadRequestException(`${location.name} no es una tienda: una bodega no tiene mostrador`);
    }
  }

  private async assertModel(manager: EntityManager, companyId: string, productId: string, colorId: string): Promise<void> {
    const exists = await manager.getRepository(ProductVariant).existsBy({ companyId, productId, colorId });
    if (!exists) throw new NotFoundException('Ese modelo no existe: no hay ninguna talla de esa referencia en ese color');
  }
}
