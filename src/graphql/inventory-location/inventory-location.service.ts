import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, EntityManager, Repository } from 'typeorm';
import { RecordStatus } from '../../common/enums/record-status.enum.js';
import { Location } from '../location/entities/location.entity.js';
import { User } from '../user/entities/user.entity.js';
import { UserCompanyRole } from '../user-company-role/entities/user-company-role.entity.js';
import { runIdempotent } from '../idempotency/idempotency.js';
import { CreateInventoryLocationInput } from './dto/create-inventory-location.input.js';
import { InventoryLocation } from './entities/inventory-location.entity.js';
import { InventoryLocationType } from './entities/inventory-location-type.enum.js';

export interface InventoryLocationFilter {
  type?: InventoryLocationType;
  locationId?: string;
  status?: RecordStatus;
}

// Todo se hace dentro de la empresa activa. A diferencia de la caja de una tienda, esto no nace
// solo: se crea a mano, y puede haber más de uno del mismo tipo para la misma sede.
@Injectable()
export class InventoryLocationService {
  constructor(
    @InjectRepository(InventoryLocation)
    private readonly inventoryLocationRepository: Repository<InventoryLocation>,
    private readonly dataSource: DataSource,
  ) {}

  findAll(companyId: string, filter: InventoryLocationFilter = {}): Promise<InventoryLocation[]> {
    return this.inventoryLocationRepository.find({
      where: {
        companyId,
        ...(filter.type && { type: filter.type }),
        ...(filter.locationId && { locationId: filter.locationId }),
        ...(filter.status && { status: filter.status }),
      },
      order: { createdAt: 'ASC' },
    });
  }

  async findOne(companyId: string, id: string): Promise<InventoryLocation> {
    const inventoryLocation = await this.inventoryLocationRepository.findOneBy({ id, companyId });
    if (!inventoryLocation) throw new NotFoundException(`Ubicación de inventario ${id} no encontrada`);
    return inventoryLocation;
  }

  async create(
    companyId: string,
    userId: string,
    input: CreateInventoryLocationInput,
    idempotencyKey?: string,
  ): Promise<InventoryLocation> {
    return this.dataSource.transaction((manager) =>
      runIdempotent(
        manager,
        {
          companyId,
          userId,
          operation: 'createInventoryLocation',
          key: idempotencyKey,
          input,
          resourceType: 'inventoryLocation',
        },
        async () => {
          await this.assertShape(manager, companyId, input.type, input.locationId, input.custodianUserId);

          const repo = manager.getRepository(InventoryLocation);
          return repo.save(
            repo.create({
              companyId,
              type: input.type,
              locationId: input.locationId ?? null,
              custodianUserId: input.custodianUserId ?? null,
            }),
          );
        },
        (id) => manager.getRepository(InventoryLocation).findOneByOrFail({ id }),
      ),
    );
  }

  // La ubicación RETURNS de una sede, para poner ahí lo que vuelve de una devolución (ver
  // SaleReturnService.restockReturnedItems). A diferencia del resto (que "no nace sola": alguien
  // la crea a mano), esta sí se crea sola la primera vez que una sede la necesita: una devolución
  // no puede fallar solo porque nadie configuró todavía dónde poner lo devuelto. Si ya hay una
  // (la haya creado esto mismo antes, o a mano un administrador), se usa la más antigua; puede
  // haber más de una, igual que con cualquier otro tipo (ver la entidad).
  async findOrCreateReturnsLocation(
    manager: EntityManager,
    companyId: string,
    storeId: string,
  ): Promise<InventoryLocation> {
    const repo = manager.getRepository(InventoryLocation);
    const existing = await repo.findOne({
      where: {
        companyId,
        locationId: storeId,
        type: InventoryLocationType.RETURNS,
        status: RecordStatus.ACTIVE,
      },
      order: { createdAt: 'ASC' },
    });
    if (existing) return existing;

    return repo.save(
      repo.create({
        companyId,
        type: InventoryLocationType.RETURNS,
        locationId: storeId,
        custodianUserId: null,
      }),
    );
  }

  // El STOCK de una sede puntual (no "el que más tenga de toda la empresa": eso es
  // InventoryBalanceService.findStockLocationForSale, para cuando no importa cuál tienda). La usan
  // WriteOffService y InternalOrderService, que sí ya saben de qué sede están descontando.
  async findStockLocation(manager: EntityManager, companyId: string, locationId: string): Promise<InventoryLocation> {
    const stockLocation = await manager.getRepository(InventoryLocation).findOne({
      where: {
        companyId,
        locationId,
        type: InventoryLocationType.STOCK,
        status: RecordStatus.ACTIVE,
      },
      order: { createdAt: 'ASC' },
    });
    if (!stockLocation) {
      throw new NotFoundException('Esta sede no tiene una ubicación de inventario STOCK activa');
    }
    return stockLocation;
  }

  // La bolsa de un corredor: igual que findOrCreateReturnsLocation, se crea sola la primera vez
  // que ese corredor la necesita (al tomar su primer pedido), y de ahí en más se reutiliza la
  // misma en todos sus pedidos — no una por pedido. Ver InternalOrderService.pickUp.
  async findOrCreateRunnerLocation(
    manager: EntityManager,
    companyId: string,
    runnerUserId: string,
  ): Promise<InventoryLocation> {
    const repo = manager.getRepository(InventoryLocation);
    const existing = await repo.findOne({
      where: {
        companyId,
        custodianUserId: runnerUserId,
        type: InventoryLocationType.RUNNER,
        status: RecordStatus.ACTIVE,
      },
      order: { createdAt: 'ASC' },
    });
    if (existing) return existing;

    return repo.save(
      repo.create({
        companyId,
        type: InventoryLocationType.RUNNER,
        locationId: null,
        custodianUserId: runnerUserId,
      }),
    );
  }

  async deactivate(companyId: string, id: string): Promise<InventoryLocation> {
    await this.findOne(companyId, id);
    return this.dataSource.transaction(async (manager) => {
      const inventoryLocation = await this.lock(manager, companyId, id);
      inventoryLocation.status = RecordStatus.INACTIVE;
      return manager.getRepository(InventoryLocation).save(inventoryLocation);
    });
  }

  async activate(companyId: string, id: string): Promise<InventoryLocation> {
    await this.findOne(companyId, id);
    return this.dataSource.transaction(async (manager) => {
      const inventoryLocation = await this.lock(manager, companyId, id);
      inventoryLocation.status = RecordStatus.ACTIVE;
      return manager.getRepository(InventoryLocation).save(inventoryLocation);
    });
  }

  private async lock(manager: EntityManager, companyId: string, id: string): Promise<InventoryLocation> {
    const inventoryLocation = await manager
      .getRepository(InventoryLocation)
      .findOne({ where: { id, companyId }, lock: { mode: 'pessimistic_write' } });
    if (!inventoryLocation) throw new NotFoundException(`Ubicación de inventario ${id} no encontrada`);
    return inventoryLocation;
  }

  // Qué exige cada tipo (decisión del 2026-09-28, ajustable cuando exista el flujo de corredores):
  //   STOCK/DISPLAY/DAMAGED/RETURNS  siempre necesitan saber la sede (dónde quedó lo dañado, lo
  //                                  devuelto, lo que hay en bodega o en vitrina)
  //   RUNNER                        necesita el custodio (quién lo tiene encima), nunca una sede
  //   TRANSIT                       libre: por ahora no depende de sede ni de custodio
  private async assertShape(
    manager: EntityManager,
    companyId: string,
    type: InventoryLocationType,
    locationId: string | undefined,
    custodianUserId: string | undefined,
  ): Promise<void> {
    const needsLocation = (
      [
        InventoryLocationType.STOCK,
        InventoryLocationType.DISPLAY,
        InventoryLocationType.DAMAGED,
        InventoryLocationType.RETURNS,
      ] as InventoryLocationType[]
    ).includes(type);

    if (needsLocation) {
      if (!locationId) throw new BadRequestException(`Una ubicación de tipo ${type} necesita una sede`);
      await this.assertLocation(manager, companyId, locationId);
    }

    if (type === InventoryLocationType.RUNNER) {
      if (!custodianUserId) {
        throw new BadRequestException('Una ubicación de tipo RUNNER necesita quién la tiene encima');
      }
      if (locationId) throw new BadRequestException('Una ubicación de tipo RUNNER no lleva sede');
      await this.assertCustodian(manager, companyId, custodianUserId);
    } else if (custodianUserId) {
      throw new BadRequestException(`Una ubicación de tipo ${type} no lleva custodio`);
    }
  }

  private async assertLocation(manager: EntityManager, companyId: string, locationId: string): Promise<void> {
    const exists = await manager.getRepository(Location).existsBy({ id: locationId, companyId });
    if (!exists) throw new NotFoundException(`Sede ${locationId} no encontrada`);
  }

  private async assertCustodian(manager: EntityManager, companyId: string, custodianUserId: string): Promise<void> {
    const isMember = await manager.getRepository(UserCompanyRole).existsBy({
      userId: custodianUserId,
      companyId,
      status: RecordStatus.ACTIVE,
    });
    // Una membresía activa no basta: la cuenta misma pudo desactivarse sin que se le quitaran sus roles.
    const accountActive =
      isMember && (await manager.getRepository(User).existsBy({ id: custodianUserId, status: RecordStatus.ACTIVE }));
    if (!accountActive) throw new NotFoundException(`Usuario ${custodianUserId} no encontrado`);
  }
}
