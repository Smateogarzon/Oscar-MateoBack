import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { InventoryBalance } from './entities/inventory-balance.entity.js';
import { InventorySide } from './entities/inventory-side.enum.js';

export interface InventoryBalanceFilter {
  productVariantId?: string;
  inventoryLocationId?: string;
  side?: InventorySide;
}

// Sin escritura propia: la mantiene InventoryMovementService (ver la entidad). La empresa no vive
// en esta tabla; se llega a ella a través de la variante, que sí es de una sola empresa.
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
}
