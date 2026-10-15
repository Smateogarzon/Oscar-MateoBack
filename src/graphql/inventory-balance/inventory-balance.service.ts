import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { Decimal } from 'decimal.js';
import { InjectRepository } from '@nestjs/typeorm';
import type { EntityManager } from 'typeorm';
import { Repository } from 'typeorm';
import { RecordStatus } from '../../common/enums/record-status.enum.js';
import { InventoryLocationType } from '../inventory-location/entities/inventory-location-type.enum.js';
import type { SellableStockObjectType } from './dto/sellable-stock.object-type.js';
import { InventoryBalance } from './entities/inventory-balance.entity.js';

export interface InventoryBalanceFilter {
  productVariantId?: string;
  inventoryLocationId?: string;
}

// Lo que hay y lo disponible de una variante en una bodega STOCK (ver `stockAvailability`).
interface StockAvailability {
  productVariantId: string;
  inventoryLocationId: string;
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

  findAll(companyId: string, filter: InventoryBalanceFilter = {}): Promise<InventoryBalance[]> {
    return this.inventoryBalanceRepository.find({
      where: {
        productVariant: { companyId },
        ...(filter.productVariantId && { productVariantId: filter.productVariantId }),
        ...(filter.inventoryLocationId && { inventoryLocationId: filter.inventoryLocationId }),
      },
    });
  }

  async findOne(companyId: string, id: string): Promise<InventoryBalance> {
    const balance = await this.inventoryBalanceRepository.findOne({
      where: { id, productVariant: { companyId } },
    });
    if (!balance) throw new NotFoundException(`Existencia ${id} no encontrada`);
    return balance;
  }

  // Fija o quita el mínimo de una existencia sin registrar un movimiento. Un UPDATE de esa sola
  // columna: no pisa la cantidad que un movimiento esté ajustando en paralelo.
  async updateMinStock(companyId: string, id: string, minStock: string): Promise<InventoryBalance> {
    await this.findOne(companyId, id);
    await this.inventoryBalanceRepository.update({ id }, { minStock: minStock ? new Decimal(minStock) : null });
    return this.findOne(companyId, id);
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
  ): Promise<string> {
    const candidates = await this.stockAvailability(manager, companyId, productVariantId);
    if (candidates.length === 0) {
      throw new NotFoundException('Esta variante no tiene existencia registrada en ninguna bodega');
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
          : `No hay suficiente existencia en una sola bodega: la mayor tiene ${best.available.toFixed(2)} disponibles y se pidieron ${quantity.toFixed(2)}`,
      );
    }
    return best.inventoryLocationId;
  }

  // Lo que se puede vender de cada variante de la empresa: lo disponible en la bodega STOCK que más
  // tiene, que es lo máximo que acepta una línea de venta (sale entera de una sola bodega; ver
  // findStockLocationForSale). Con esto el selector de productos de Ventas muestra lo agotado y no
  // deja pedir de más, con la misma cuenta con la que después se aparta, sin repetirla en el cliente.
  async findSellableStock(companyId: string): Promise<SellableStockObjectType[]> {
    const best = new Map<string, Decimal>();
    for (const row of await this.stockAvailability(this.inventoryBalanceRepository.manager, companyId)) {
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
    const rows: { productVariantId: string; inventoryLocationId: string; quantity: string; available: string }[] =
      await manager.query(
        `SELECT b."productVariantId" AS "productVariantId", b."inventoryLocationId" AS "inventoryLocationId",
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
      quantity: new Decimal(row.quantity),
      available: new Decimal(row.available),
    }));
  }
}
