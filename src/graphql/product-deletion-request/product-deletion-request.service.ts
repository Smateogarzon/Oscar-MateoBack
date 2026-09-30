import { ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, EntityManager, Repository } from 'typeorm';
import { PermissionCode } from '../../common/enums/permission-code.enum.js';
import { runIdempotent } from '../idempotency/idempotency.js';
import { NotificationChannel } from '../notification/entities/notification-channel.enum.js';
import { NotificationEntityType } from '../notification/entities/notification-entity-type.enum.js';
import { NotificationType } from '../notification/entities/notification-type.enum.js';
import { NotificationService } from '../notification/notification.service.js';
import { Product } from '../product/entities/product.entity.js';
import { ProductService } from '../product/product.service.js';
import { ProductDeletionRequestNotesInput } from './dto/product-deletion-request-notes.input.js';
import { RequestProductDeletionInput } from './dto/request-product-deletion.input.js';
import {
  ACTIVE_PRODUCT_DELETION_REQUEST_STATUSES,
  ProductDeletionRequestStatus,
} from './entities/product-deletion-request-status.enum.js';
import { ProductDeletionRequest } from './entities/product-deletion-request.entity.js';

export interface ProductDeletionRequestActor {
  userId: string;
  /** Ve todas las solicitudes de la empresa (tiene inventory.manage_products); si no, solo las
   * que él mismo pidió. */
  canReadAll: boolean;
}

// Flujo de borrado de una referencia: quien no puede borrarla directo la pide, y un
// administrador la aprueba (la borra o la desactiva, según corresponda — ver
// ProductService.deleteReference) o la rechaza. Un producto tiene a lo sumo UNA solicitud activa
// (pendiente): rechazada o cancelada, se puede pedir otra. Cada paso avisa a la otra parte (canal
// Inventario, ver NotificationService) dentro de la misma transacción.
@Injectable()
export class ProductDeletionRequestService {
  constructor(
    @InjectRepository(ProductDeletionRequest)
    private readonly requestRepository: Repository<ProductDeletionRequest>,
    private readonly dataSource: DataSource,
    private readonly products: ProductService,
    private readonly notifications: NotificationService,
  ) {}

  findAll(
    companyId: string,
    actor: ProductDeletionRequestActor,
    filters: { status?: ProductDeletionRequestStatus } = {},
  ): Promise<ProductDeletionRequest[]> {
    return this.requestRepository.find({
      where: {
        ...(filters.status && { status: filters.status }),
        product: { companyId },
        ...(!actor.canReadAll && { requestedBy: actor.userId }),
      },
      relations: { product: true },
      order: { requestedAt: 'DESC' },
    });
  }

  async findOne(companyId: string, actor: ProductDeletionRequestActor, id: string): Promise<ProductDeletionRequest> {
    const request = await this.requestRepository.findOne({ where: { id, product: { companyId } }, relations: { product: true } });
    if (!request) throw new NotFoundException(`Solicitud ${id} no encontrada`);
    if (!actor.canReadAll && request.requestedBy !== actor.userId) {
      throw new NotFoundException(`Solicitud ${id} no encontrada`);
    }
    return request;
  }

  // La referencia (el código de estilo) del producto de la solicitud, para el texto del aviso y
  // para mostrarla en la bandeja sin pedir todos los productos.
  async productReferenceOf(request: ProductDeletionRequest): Promise<string | null> {
    if (request.product) return request.product.reference;
    const product = await this.dataSource.getRepository(Product).findOne({ where: { id: request.productId }, select: { id: true, reference: true } });
    return product?.reference ?? null;
  }

  async request(
    companyId: string,
    requesterId: string,
    input: RequestProductDeletionInput,
    idempotencyKey?: string,
  ): Promise<ProductDeletionRequest> {
    return this.dataSource.transaction((manager) =>
      runIdempotent(
        manager,
        {
          companyId,
          userId: requesterId,
          operation: 'requestProductDeletion',
          key: idempotencyKey,
          input,
          resourceType: 'product_deletion_request',
        },
        async () => {
          const product = await manager.getRepository(Product).findOneBy({ id: input.productId, companyId });
          if (!product) throw new NotFoundException(`Producto ${input.productId} no encontrado`);

          const repo = manager.getRepository(ProductDeletionRequest);
          const hasActiveRequest = await repo.existsBy({
            productId: product.id,
            status: ProductDeletionRequestStatus.PENDING,
          });
          if (hasActiveRequest) {
            throw new ConflictException('Esta referencia ya tiene una solicitud de borrado activa');
          }

          const request = await repo.save(
            repo.create({
              productId: product.id,
              requestedBy: requesterId,
              reason: input.reason?.trim() || null,
              status: ProductDeletionRequestStatus.PENDING,
            }),
          );

          await this.notifyApprovers(manager, companyId, NotificationType.PRODUCT_DELETION_REQUESTED, request, product, requesterId);
          return request;
        },
        (id) => manager.getRepository(ProductDeletionRequest).findOneByOrFail({ id }),
      ),
    );
  }

  async approve(
    companyId: string,
    resolverId: string,
    id: string,
    roleCodes: readonly string[],
    input: ProductDeletionRequestNotesInput,
    idempotencyKey?: string,
  ): Promise<ProductDeletionRequest> {
    return this.dataSource.transaction((manager) =>
      runIdempotent(
        manager,
        {
          companyId,
          userId: resolverId,
          operation: 'approveProductDeletionRequest',
          key: idempotencyKey,
          input: { id, ...input },
          resourceType: 'product_deletion_request',
        },
        async () => {
          const { request, product } = await this.lockRequestAndProduct(manager, companyId, id);
          if (request.status !== ProductDeletionRequestStatus.PENDING) {
            throw new ConflictException('La solicitud ya fue resuelta');
          }

          // Dentro de esta misma transacción (no una aparte): si el borrado falla, la solicitud se
          // queda pendiente en vez de quedar aprobada sin haberse aplicado.
          await this.products.deleteReferenceWithin(manager, companyId, roleCodes, product.id);

          request.status = ProductDeletionRequestStatus.APPROVED;
          this.markResolved(request, resolverId, input.notes);
          const saved = await manager.getRepository(ProductDeletionRequest).save(request);

          await this.notifyRequester(manager, companyId, NotificationType.PRODUCT_DELETION_APPROVED, request, product, resolverId);
          await this.clearPendingNotices(manager, companyId, request, resolverId);
          return saved;
        },
        (requestId) => manager.getRepository(ProductDeletionRequest).findOneByOrFail({ id: requestId }),
      ),
    );
  }

  async reject(
    companyId: string,
    resolverId: string,
    id: string,
    input: ProductDeletionRequestNotesInput,
    idempotencyKey?: string,
  ): Promise<ProductDeletionRequest> {
    return this.dataSource.transaction((manager) =>
      runIdempotent(
        manager,
        {
          companyId,
          userId: resolverId,
          operation: 'rejectProductDeletionRequest',
          key: idempotencyKey,
          input: { id, ...input },
          resourceType: 'product_deletion_request',
        },
        async () => {
          const { request, product } = await this.lockRequestAndProduct(manager, companyId, id);
          if (request.status !== ProductDeletionRequestStatus.PENDING) {
            throw new ConflictException('La solicitud ya fue resuelta');
          }

          request.status = ProductDeletionRequestStatus.REJECTED;
          this.markResolved(request, resolverId, input.notes);
          const saved = await manager.getRepository(ProductDeletionRequest).save(request);

          await this.notifyRequester(
            manager,
            companyId,
            NotificationType.PRODUCT_DELETION_REJECTED,
            request,
            product,
            resolverId,
            request.resolutionNotes,
          );
          await this.clearPendingNotices(manager, companyId, request, resolverId);
          return saved;
        },
        (requestId) => manager.getRepository(ProductDeletionRequest).findOneByOrFail({ id: requestId }),
      ),
    );
  }

  // La puede cancelar quien la pidió o quien puede aprobarla (`canApprove`).
  async cancel(
    companyId: string,
    userId: string,
    id: string,
    canApprove: boolean,
    input: ProductDeletionRequestNotesInput,
  ): Promise<ProductDeletionRequest> {
    return this.dataSource.transaction(async (manager) => {
      const { request, product } = await this.lockRequestAndProduct(manager, companyId, id);

      if (!ACTIVE_PRODUCT_DELETION_REQUEST_STATUSES.includes(request.status)) {
        throw new ConflictException('La solicitud ya no está activa');
      }
      if (request.requestedBy !== userId && !canApprove) {
        throw new ForbiddenException('Solo quien la pidió o quien la puede aprobar puede cancelarla');
      }

      request.status = ProductDeletionRequestStatus.CANCELLED;
      this.markResolved(request, userId, input.notes);
      const saved = await manager.getRepository(ProductDeletionRequest).save(request);

      const type = NotificationType.PRODUCT_DELETION_CANCELLED;
      if (userId === request.requestedBy) {
        await this.notifyApprovers(manager, companyId, type, request, product, userId, request.resolutionNotes);
      } else {
        await this.notifyRequester(manager, companyId, type, request, product, userId, request.resolutionNotes);
      }
      await this.clearPendingNotices(manager, companyId, request, userId);
      return saved;
    });
  }

  private async notifyApprovers(
    manager: EntityManager,
    companyId: string,
    type: NotificationType,
    request: ProductDeletionRequest,
    product: Product,
    actorId: string,
    notes?: string | null,
  ): Promise<void> {
    const recipientIds = await this.notifications.findUserIdsWithPermission(
      manager,
      companyId,
      PermissionCode.INVENTORY_MANAGE_PRODUCTS,
    );
    await this.notify(manager, companyId, type, request, product, actorId, recipientIds, notes);
  }

  private notifyRequester(
    manager: EntityManager,
    companyId: string,
    type: NotificationType,
    request: ProductDeletionRequest,
    product: Product,
    actorId: string,
    notes?: string | null,
  ): Promise<void> {
    return this.notify(manager, companyId, type, request, product, actorId, [request.requestedBy], notes);
  }

  private async notify(
    manager: EntityManager,
    companyId: string,
    type: NotificationType,
    request: ProductDeletionRequest,
    product: Product,
    actorId: string,
    recipientIds: string[],
    notes?: string | null,
  ): Promise<void> {
    await this.notifications.notify(manager, {
      companyId,
      type,
      recipientIds,
      actorId,
      entityType: NotificationEntityType.PRODUCT_DELETION_REQUEST,
      entityId: request.id,
      locationId: null,
      reference: product.reference,
      notes,
    });
  }

  private async clearPendingNotices(
    manager: EntityManager,
    companyId: string,
    request: ProductDeletionRequest,
    actorId: string,
  ): Promise<void> {
    await this.notifications.markEntityRead(manager, NotificationEntityType.PRODUCT_DELETION_REQUEST, request.id, [
      NotificationType.PRODUCT_DELETION_REQUESTED,
    ]);

    const approverIds = await this.notifications.findUserIdsWithPermission(manager, companyId, PermissionCode.INVENTORY_MANAGE_PRODUCTS);
    this.notifications.signalChange(manager, {
      companyId,
      channel: NotificationChannel.INVENTORY,
      entityType: NotificationEntityType.PRODUCT_DELETION_REQUEST,
      entityId: request.id,
      recipientIds: approverIds,
      exceptUserId: actorId,
    });
  }

  private async lockRequestAndProduct(
    manager: EntityManager,
    companyId: string,
    id: string,
  ): Promise<{ request: ProductDeletionRequest; product: Product }> {
    const found = await manager.getRepository(ProductDeletionRequest).findOneBy({ id });
    const product = found ? await manager.getRepository(Product).findOneBy({ id: found.productId, companyId }) : null;
    if (!found || !product) throw new NotFoundException(`Solicitud ${id} no encontrada`);

    const request = await manager
      .getRepository(ProductDeletionRequest)
      .findOne({ where: { id }, lock: { mode: 'pessimistic_write' } });
    if (!request) throw new NotFoundException(`Solicitud ${id} no encontrada`);
    return { request, product };
  }

  private markResolved(request: ProductDeletionRequest, userId: string, notes?: string | null): void {
    request.resolvedBy = userId;
    request.resolvedAt = new Date();
    request.resolutionNotes = notes?.trim() || null;
  }
}
