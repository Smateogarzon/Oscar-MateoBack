import { ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Decimal } from 'decimal.js';
import { DataSource, EntityManager, Repository } from 'typeorm';
import { Incident } from '../incident/entities/incident.entity.js';
import { InventorySide } from '../inventory-balance/entities/inventory-side.enum.js';
import { InventoryLocationService } from '../inventory-location/inventory-location.service.js';
import { InventoryMovementType } from '../inventory-movement/entities/inventory-movement-type.enum.js';
import { InventorySourceType } from '../inventory-movement/entities/inventory-source-type.enum.js';
import { InventoryMovementService } from '../inventory-movement/inventory-movement.service.js';
import { runIdempotent } from '../idempotency/idempotency.js';
import { Location } from '../location/entities/location.entity.js';
import { ProductVariant } from '../product-variant/entities/product-variant.entity.js';
import { DocumentSequenceService } from '../document-sequence/document-sequence.service.js';
import { RequestWriteOffInput } from './dto/request-write-off.input.js';
import { WriteOffItem } from './entities/write-off-item.entity.js';
import { WriteOffStatus } from './entities/write-off-status.enum.js';
import { WriteOff } from './entities/write-off.entity.js';
import { formatWriteOffNumber, WRITE_OFF_SERIES } from './write-off-number.js';

export interface WriteOffFilter {
  status?: WriteOffStatus;
  locationId?: string;
}

// Pedir una baja no mueve nada todavía: la aprobación es la que de verdad descuenta la existencia
// (ver `approve`), en la misma transacción que cambia el estado — igual que aprobar una
// devolución ya entrega el reembolso. Rechazar o cancelar nunca tocan inventario.
@Injectable()
export class WriteOffService {
  constructor(
    @InjectRepository(WriteOff)
    private readonly writeOffRepository: Repository<WriteOff>,
    private readonly dataSource: DataSource,
    private readonly sequences: DocumentSequenceService,
    private readonly inventoryMovements: InventoryMovementService,
    private readonly inventoryLocations: InventoryLocationService,
  ) {}

  findAll(companyId: string, filter: WriteOffFilter = {}): Promise<WriteOff[]> {
    return this.writeOffRepository.find({
      where: {
        companyId,
        ...(filter.status && { status: filter.status }),
        ...(filter.locationId && { locationId: filter.locationId }),
      },
      order: { requestedAt: 'DESC' },
    });
  }

  async findOne(companyId: string, id: string): Promise<WriteOff> {
    const writeOff = await this.writeOffRepository.findOneBy({ id, companyId });
    if (!writeOff) throw new NotFoundException(`Baja ${id} no encontrada`);
    return writeOff;
  }

  findItems(companyId: string, writeOffId: string): Promise<WriteOffItem[]> {
    return this.findOne(companyId, writeOffId).then((writeOff) =>
      this.dataSource.manager.find(WriteOffItem, { where: { writeOffId: writeOff.id }, order: { createdAt: 'ASC' } }),
    );
  }

  async request(
    companyId: string,
    userId: string,
    input: RequestWriteOffInput,
    idempotencyKey?: string,
  ): Promise<WriteOff> {
    return this.dataSource.transaction((manager) =>
      runIdempotent(
        manager,
        {
          companyId,
          userId,
          operation: 'requestWriteOff',
          key: idempotencyKey,
          input,
          resourceType: 'writeOff',
        },
        async () => {
          await this.assertLocation(manager, companyId, input.locationId);
          for (const item of input.items) {
            await this.assertProductVariant(manager, companyId, item.productVariantId);
            if (item.incidentId) await this.assertIncident(manager, companyId, item.incidentId);
          }

          const number = await this.sequences.next(manager, companyId, WRITE_OFF_SERIES);
          const writeOffRepo = manager.getRepository(WriteOff);
          const writeOff = await writeOffRepo.save(
            writeOffRepo.create({
              companyId,
              locationId: input.locationId,
              writeOffNumber: formatWriteOffNumber(number),
              reason: input.reason?.trim() || null,
              notes: input.notes?.trim() || null,
              requestedBy: userId,
              resolvedBy: null,
              requestedAt: new Date(),
              resolvedAt: null,
            }),
          );

          const itemRepo = manager.getRepository(WriteOffItem);
          await itemRepo.save(
            input.items.map((item) =>
              itemRepo.create({
                writeOffId: writeOff.id,
                productVariantId: item.productVariantId,
                quantity: new Decimal(item.quantity),
                incidentId: item.incidentId ?? null,
                notes: item.notes?.trim() || null,
              }),
            ),
          );

          return writeOff;
        },
        (id) => manager.getRepository(WriteOff).findOneByOrFail({ id }),
      ),
    );
  }

  // Aprobar es lo que de verdad descuenta: una fila de movimiento ADJUSTMENT por cada línea, desde
  // el STOCK de la sede de la baja. Si a alguna línea no le alcanza la existencia, nada se guarda
  // (toda la baja, o ninguna).
  async approve(companyId: string, userId: string, id: string): Promise<WriteOff> {
    await this.findOne(companyId, id);
    return this.dataSource.transaction(async (manager) => {
      const writeOff = await this.lock(manager, companyId, id);
      this.assertPending(writeOff);

      const stockLocation = await this.inventoryLocations.findStockLocation(manager, companyId, writeOff.locationId);
      const items = await manager
        .getRepository(WriteOffItem)
        .find({ where: { writeOffId: writeOff.id }, order: { createdAt: 'ASC' } });

      for (const item of items) {
        await this.inventoryMovements.recordInTransaction(manager, companyId, userId, {
          productVariantId: item.productVariantId,
          fromLocationId: stockLocation.id,
          side: InventorySide.PAIR,
          quantity: item.quantity,
          type: InventoryMovementType.ADJUSTMENT,
          sourceType: InventorySourceType.MANUAL_ADJUSTMENT,
          sourceId: writeOff.id,
          sourceNumber: writeOff.writeOffNumber,
          notes: `Baja ${writeOff.writeOffNumber}`,
        });
      }

      writeOff.status = WriteOffStatus.APPROVED;
      writeOff.resolvedBy = userId;
      writeOff.resolvedAt = new Date();
      return manager.getRepository(WriteOff).save(writeOff);
    });
  }

  async reject(companyId: string, userId: string, id: string): Promise<WriteOff> {
    await this.findOne(companyId, id);
    return this.dataSource.transaction(async (manager) => {
      const writeOff = await this.lock(manager, companyId, id);
      this.assertPending(writeOff);
      writeOff.status = WriteOffStatus.REJECTED;
      writeOff.resolvedBy = userId;
      writeOff.resolvedAt = new Date();
      return manager.getRepository(WriteOff).save(writeOff);
    });
  }

  // Quien la pidió puede arrepentirse mientras nadie la haya resuelto; quien aprueba también puede
  // cancelarla en vez de rechazarla (por ejemplo, si ya no aplica por otra razón).
  async cancel(
    companyId: string,
    actor: { userId: string; canResolve: boolean },
    id: string,
  ): Promise<WriteOff> {
    await this.findOne(companyId, id);
    return this.dataSource.transaction(async (manager) => {
      const writeOff = await this.lock(manager, companyId, id);
      this.assertPending(writeOff);
      if (writeOff.requestedBy !== actor.userId && !actor.canResolve) {
        throw new ForbiddenException('Solo quien la pidió, o quien aprueba bajas, puede cancelarla');
      }
      writeOff.status = WriteOffStatus.CANCELLED;
      writeOff.resolvedBy = actor.userId;
      writeOff.resolvedAt = new Date();
      return manager.getRepository(WriteOff).save(writeOff);
    });
  }

  private assertPending(writeOff: WriteOff): void {
    if (writeOff.status !== WriteOffStatus.PENDING) {
      throw new ConflictException('Esta baja ya se resolvió');
    }
  }

  private async lock(manager: EntityManager, companyId: string, id: string): Promise<WriteOff> {
    const writeOff = await manager
      .getRepository(WriteOff)
      .findOne({ where: { id, companyId }, lock: { mode: 'pessimistic_write' } });
    if (!writeOff) throw new NotFoundException(`Baja ${id} no encontrada`);
    return writeOff;
  }

  private async assertLocation(manager: EntityManager, companyId: string, locationId: string): Promise<void> {
    const exists = await manager.getRepository(Location).existsBy({ id: locationId, companyId });
    if (!exists) throw new NotFoundException(`Sede ${locationId} no encontrada`);
  }

  private async assertProductVariant(
    manager: EntityManager,
    companyId: string,
    productVariantId: string,
  ): Promise<void> {
    const exists = await manager.getRepository(ProductVariant).existsBy({ id: productVariantId, companyId });
    if (!exists) throw new NotFoundException(`Variante ${productVariantId} no encontrada`);
  }

  private async assertIncident(manager: EntityManager, companyId: string, incidentId: string): Promise<void> {
    const exists = await manager.getRepository(Incident).existsBy({ id: incidentId, companyId });
    if (!exists) throw new NotFoundException(`Novedad ${incidentId} no encontrada`);
  }
}
