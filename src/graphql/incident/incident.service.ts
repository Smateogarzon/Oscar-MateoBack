import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, EntityManager, Repository } from 'typeorm';
import { Location } from '../location/entities/location.entity.js';
import { runIdempotent } from '../idempotency/idempotency.js';
import { ProductVariant } from '../product-variant/entities/product-variant.entity.js';
import { CreateIncidentInput } from './dto/create-incident.input.js';
import { Incident } from './entities/incident.entity.js';
import { IncidentStatus } from './entities/incident-status.enum.js';
import { IncidentType } from './entities/incident-type.enum.js';

// Mismo valor que escribe purchase-order-incidents.ts al abrir la novedad de una línea de compra.
const PURCHASE_ORDER_ITEM_ENTITY = 'PURCHASE_ORDER_ITEM';

export interface IncidentFilter {
  type?: IncidentType;
  status?: IncidentStatus;
  locationId?: string;
}

// Cualquier miembro puede reportar (ver el resolver: sin permiso especial); resolverla o
// cancelarla sí exige inventory.manage_products, igual que el resto de esta área — el día que
// existan pedidos, corredores o proveedores, sus propias novedades podrán pedir su propio permiso.
@Injectable()
export class IncidentService {
  constructor(
    @InjectRepository(Incident)
    private readonly incidentRepository: Repository<Incident>,
    private readonly dataSource: DataSource,
  ) {}

  // `supplierId` acota a las novedades de las líneas de SUS órdenes (las que nacen del recibo o del
  // despacho de compras, con entityType PURCHASE_ORDER_ITEM). Sin él, ve toda la empresa: lo decide el
  // resolver según el rol.
  findAll(companyId: string, filter: IncidentFilter = {}, supplierId?: string): Promise<Incident[]> {
    if (supplierId) return this.findAllForSupplier(companyId, supplierId, filter);
    return this.incidentRepository.find({
      where: {
        companyId,
        ...(filter.type && { type: filter.type }),
        ...(filter.status && { status: filter.status }),
        ...(filter.locationId && { locationId: filter.locationId }),
      },
      order: { createdAt: 'DESC' },
    });
  }

  async findOne(companyId: string, id: string, supplierId?: string): Promise<Incident> {
    const incident = supplierId
      ? await this.supplierScope(companyId, supplierId).andWhere('incident.id = :id', { id }).getOne()
      : await this.incidentRepository.findOneBy({ id, companyId });
    if (!incident) throw new NotFoundException(`Novedad ${id} no encontrada`);
    return incident;
  }

  private findAllForSupplier(companyId: string, supplierId: string, filter: IncidentFilter): Promise<Incident[]> {
    const qb = this.supplierScope(companyId, supplierId).orderBy('incident.createdAt', 'DESC');
    if (filter.type) qb.andWhere('incident.type = :type', { type: filter.type });
    if (filter.status) qb.andWhere('incident.status = :status', { status: filter.status });
    if (filter.locationId) qb.andWhere('incident.locationId = :locationId', { locationId: filter.locationId });
    return qb.getMany();
  }

  // Solo las novedades de las líneas cuya orden es de este proveedor, dentro de la empresa.
  private supplierScope(companyId: string, supplierId: string) {
    return this.incidentRepository
      .createQueryBuilder('incident')
      .where('incident.companyId = :companyId', { companyId })
      .andWhere(
        `incident.entityType = :itemType AND incident.entityId IN (
           SELECT item.id FROM purchase_order_items item
           INNER JOIN purchase_orders po ON po.id = item."purchaseOrderId"
           WHERE po."supplierId" = :supplierId AND po."companyId" = :companyId)`,
        { itemType: PURCHASE_ORDER_ITEM_ENTITY, supplierId },
      );
  }

  async report(
    companyId: string,
    userId: string,
    input: CreateIncidentInput,
    idempotencyKey?: string,
  ): Promise<Incident> {
    return this.dataSource.transaction((manager) =>
      runIdempotent(
        manager,
        {
          companyId,
          userId,
          operation: 'reportIncident',
          key: idempotencyKey,
          input,
          resourceType: 'incident',
        },
        async () => {
          if (input.locationId) await this.assertLocation(manager, companyId, input.locationId);
          if (input.productVariantId) await this.assertProductVariant(manager, companyId, input.productVariantId);

          const repo = manager.getRepository(Incident);
          return repo.save(
            repo.create({
              companyId,
              type: input.type,
              title: input.title,
              description: input.description ?? null,
              entityType: input.entityType ?? null,
              entityId: input.entityId ?? null,
              locationId: input.locationId ?? null,
              productVariantId: input.productVariantId ?? null,
              reportedBy: userId,
              resolvedBy: null,
              resolvedAt: null,
            }),
          );
        },
        (id) => manager.getRepository(Incident).findOneByOrFail({ id }),
      ),
    );
  }

  // No hay quién "puso en revisión" en la entidad (solo resolvedBy, para cuando se cierra): por
  // eso no pide userId, a diferencia de resolve/cancel.
  async startReview(companyId: string, id: string): Promise<Incident> {
    await this.findOne(companyId, id);
    return this.dataSource.transaction(async (manager) => {
      const incident = await this.lock(manager, companyId, id);
      if (incident.status !== IncidentStatus.OPEN) {
        throw new ConflictException('Solo se pasa a revisión una novedad abierta');
      }
      incident.status = IncidentStatus.IN_REVIEW;
      return manager.getRepository(Incident).save(incident);
    });
  }

  async resolve(companyId: string, userId: string, id: string): Promise<Incident> {
    await this.findOne(companyId, id);
    return this.dataSource.transaction(async (manager) => {
      const incident = await this.lock(manager, companyId, id);
      this.assertOpen(incident);
      incident.status = IncidentStatus.RESOLVED;
      incident.resolvedBy = userId;
      incident.resolvedAt = new Date();
      return manager.getRepository(Incident).save(incident);
    });
  }

  async cancel(companyId: string, userId: string, id: string): Promise<Incident> {
    await this.findOne(companyId, id);
    return this.dataSource.transaction(async (manager) => {
      const incident = await this.lock(manager, companyId, id);
      this.assertOpen(incident);
      incident.status = IncidentStatus.CANCELLED;
      incident.resolvedBy = userId;
      incident.resolvedAt = new Date();
      return manager.getRepository(Incident).save(incident);
    });
  }

  private assertOpen(incident: Incident): void {
    if (incident.status === IncidentStatus.RESOLVED || incident.status === IncidentStatus.CANCELLED) {
      throw new ConflictException('Esta novedad ya se cerró');
    }
  }

  private async lock(manager: EntityManager, companyId: string, id: string): Promise<Incident> {
    const incident = await manager
      .getRepository(Incident)
      .findOne({ where: { id, companyId }, lock: { mode: 'pessimistic_write' } });
    if (!incident) throw new NotFoundException(`Novedad ${id} no encontrada`);
    return incident;
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
}
