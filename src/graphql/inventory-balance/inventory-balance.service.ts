import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { Decimal } from 'decimal.js';
import { InjectRepository } from '@nestjs/typeorm';
import type { EntityManager } from 'typeorm';
import { Repository } from 'typeorm';
import { RecordStatus } from '../../common/enums/record-status.enum.js';
import { InventoryLocation } from '../inventory-location/entities/inventory-location.entity.js';
import { InventoryLocationType } from '../inventory-location/entities/inventory-location-type.enum.js';
import { InventoryBalance } from './entities/inventory-balance.entity.js';
import { InventorySide } from './entities/inventory-side.enum.js';

export interface InventoryBalanceFilter {
  productVariantId?: string;
  inventoryLocationId?: string;
  side?: InventorySide;
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
        ...(filter.side && { side: filter.side }),
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

  // La bodega STOCK donde está registrada esta variante: hoy cada referencia vive en una sola
  // bodega satélite (no hay reparto por tienda), así que una venta descuenta de ahí sin importar en
  // qué tienda se hizo — más adelante un corredor la trae físicamente hasta el cliente (ver
  // InventoryLocationType.RUNNER), pero eso es un flujo aparte, todavía por construir.
  // Si la existencia quedara repartida en más de una bodega, se usa la que más tenga; si ni esa
  // alcanza, se rechaza en vez de partir la línea entre varias bodegas.
  async findStockLocationForSale(
    manager: EntityManager,
    companyId: string,
    productVariantId: string,
    quantity: Decimal,
    side: InventorySide,
  ): Promise<InventoryLocation> {
    const candidates = await manager
      .getRepository(InventoryBalance)
      .createQueryBuilder('balance')
      .innerJoinAndSelect('balance.inventoryLocation', 'location')
      .where('location."companyId" = :companyId', { companyId })
      .andWhere('location.type = :type', { type: InventoryLocationType.STOCK })
      .andWhere('location.status = :status', { status: RecordStatus.ACTIVE })
      .andWhere('balance."productVariantId" = :productVariantId', { productVariantId })
      .andWhere('balance.side = :side', { side })
      .andWhere('balance.quantity > 0')
      .orderBy('balance.quantity', 'DESC')
      .getMany();

    if (candidates.length === 0) {
      throw new NotFoundException('Esta variante no tiene existencia registrada en ninguna bodega');
    }
    const best = candidates[0];
    if (best.quantity.lessThan(quantity)) {
      throw new ConflictException(
        `No hay suficiente existencia en una sola bodega: la mayor tiene ${best.quantity.toFixed(2)} y se pidieron ${quantity.toFixed(2)}`,
      );
    }
    return best.inventoryLocation;
  }
}
