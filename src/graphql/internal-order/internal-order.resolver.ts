import { UseGuards } from '@nestjs/common';
import { Args, ID, Mutation, Parent, Query, ResolveField, Resolver } from '@nestjs/graphql';
import type { CompanyAccess } from '../../common/access/company-access.js';
import { CurrentCompanyAccess, CurrentCompanyId } from '../../common/decorators/current-company.decorator.js';
import { CurrentUser } from '../../common/decorators/current-user.decorator.js';
import { IdempotencyKeyHeader } from '../../common/decorators/idempotency-key.decorator.js';
import { RequireAnyPermission, RequireCompanyMembership, RequirePermissions } from '../../common/decorators/permissions.decorator.js';
import { PermissionCode } from '../../common/enums/permission-code.enum.js';
import { RoleCode } from '../../common/enums/role-code.enum.js';
import { CsrfGuard } from '../../common/guards/csrf.guard.js';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard.js';
import { PermissionsGuard } from '../../common/guards/permissions.guard.js';
import { fullName } from '../../common/utils/text.js';
import type { JwtPayload } from '../auth/interface/jwt-payload.interface.js';
import { LocationObjectType } from '../location/dto/location.object-type.js';
import { InternalOrderChangeInput } from './dto/internal-order-change.input.js';
import { InternalOrderItemObjectType } from './dto/internal-order-item.object-type.js';
import {
  InternalOrderCorrectionObjectType,
  InternalOrderEventObjectType,
  InternalOrderObjectType,
  InternalOrderVersionObjectType,
  OrderStockOptionObjectType,
} from './dto/internal-order.object-type.js';
import { InternalOrdersFilterInput } from './dto/internal-orders-filter.input.js';
import { RequestInternalOrderInput } from './dto/request-internal-order.input.js';
import { TransitionInternalOrderInput } from './dto/transition-internal-order.input.js';
import { InternalOrderNudge } from './entities/internal-order-nudge.enum.js';
import { InternalOrderService, type InternalOrderView, type OrderActor } from './internal-order.service.js';

// Quien opera, con sus permisos en la empresa activa. El super admin lo puede todo (también hacer un
// paso por el corredor asignado).
const actorOf = (user: JwtPayload, access: CompanyAccess): OrderActor => ({
  userId: user.sub,
  permissionCodes: access.permissionCodes,
  isSuperAdmin: access.roleCodes.includes(RoleCode.SUPER_ADMIN),
});

// Las consultas solo piden pertenecer a la empresa: QUÉ órdenes ve cada quien lo decide el servicio
// (bodega, corredores y quien tiene orders.view_all ven todas; los demás, las suyas y las de sus
// sedes). Las mutaciones también se validan allá, paso por paso, con la tabla del flujo.
@Resolver(() => InternalOrderObjectType)
@UseGuards(JwtAuthGuard, PermissionsGuard, CsrfGuard)
export class InternalOrderResolver {
  constructor(private readonly internalOrderService: InternalOrderService) {}

  // Leer pedidos exige orders.view (la sección de pedidos). Antes bastaba ser miembro: un proveedor
  // podía listarlos. Lo que cada rol ve dentro (su bodega, sus pedidos) queda para la Fase 6.
  @Query(() => [InternalOrderObjectType])
  @RequirePermissions(PermissionCode.ORDERS_VIEW)
  internalOrders(
    @CurrentCompanyId() companyId: string,
    @CurrentUser() user: JwtPayload,
    @CurrentCompanyAccess() access: CompanyAccess,
    @Args('filter', { type: () => InternalOrdersFilterInput, nullable: true }) filter?: InternalOrdersFilterInput,
  ) {
    return this.internalOrderService.findAll(companyId, actorOf(user, access), filter ?? {});
  }

  @Query(() => InternalOrderObjectType)
  @RequireCompanyMembership()
  internalOrder(
    @CurrentCompanyId() companyId: string,
    @CurrentUser() user: JwtPayload,
    @CurrentCompanyAccess() access: CompanyAccess,
    @Args('id', { type: () => ID }) id: string,
  ) {
    return this.internalOrderService.findDetailed(companyId, actorOf(user, access), id);
  }

  @Query(() => [InternalOrderVersionObjectType])
  @RequireCompanyMembership()
  async internalOrderVersions(
    @CurrentCompanyId() companyId: string,
    @CurrentUser() user: JwtPayload,
    @CurrentCompanyAccess() access: CompanyAccess,
    @Args('id', { type: () => ID }) id: string,
  ): Promise<InternalOrderVersionObjectType[]> {
    const versions = await this.internalOrderService.findVersions(companyId, actorOf(user, access), id);
    return versions.map((version) => ({
      id: version.id,
      createdAt: version.createdAt,
      versionNumber: version.versionNumber,
      reason: version.reason,
      createdByName: version.createdByUser ? fullName(version.createdByUser) : null,
      sourceLocationId: version.sourceLocationId,
      sourceLocationName: version.sourceLocation?.name ?? null,
      items: version.items as unknown as InternalOrderItemObjectType[],
    }));
  }

  @Query(() => [LocationObjectType])
  @RequireCompanyMembership()
  myLocations(@CurrentCompanyId() companyId: string, @CurrentUser() user: JwtPayload, @CurrentCompanyAccess() access: CompanyAccess) {
    return this.internalOrderService.myLocations(companyId, actorOf(user, access));
  }

  @Query(() => [OrderStockOptionObjectType])
  @RequireCompanyMembership()
  async orderStockOptions(
    @CurrentCompanyId() companyId: string,
    @Args('productId', { type: () => ID, nullable: true }) productId?: string,
  ) {
    const options = await this.internalOrderService.stockOptions(companyId, productId);
    return options.map((option) => ({ ...option, available: option.available.toFixed(2) }));
  }

  // ─── Mutaciones ────────────────────────────────────────────────────────────────────────────

  @Mutation(() => InternalOrderObjectType)
  @RequireAnyPermission(PermissionCode.ORDERS_REQUEST_FROM_WAREHOUSE, PermissionCode.INVENTORY_TRANSFER, PermissionCode.WAREHOUSE_FULFILL_ORDERS)
  async requestInternalOrder(
    @CurrentCompanyId() companyId: string,
    @CurrentUser() user: JwtPayload,
    @CurrentCompanyAccess() access: CompanyAccess,
    @Args('input') input: RequestInternalOrderInput,
    @IdempotencyKeyHeader() idempotencyKey?: string,
  ) {
    const order = await this.internalOrderService.request(companyId, actorOf(user, access), input, idempotencyKey);
    return this.internalOrderService.findView(companyId, order.id);
  }

  @Mutation(() => InternalOrderObjectType)
  @RequireCompanyMembership()
  async transitionInternalOrder(
    @CurrentCompanyId() companyId: string,
    @CurrentUser() user: JwtPayload,
    @CurrentCompanyAccess() access: CompanyAccess,
    @Args('input') input: TransitionInternalOrderInput,
  ) {
    const order = await this.internalOrderService.transition(companyId, actorOf(user, access), input);
    return this.internalOrderService.findView(companyId, order.id);
  }

  @Mutation(() => InternalOrderObjectType)
  @RequireAnyPermission(PermissionCode.ORDERS_CONFIRM_RECEIPT, PermissionCode.ORDERS_REQUEST_FROM_WAREHOUSE)
  async requestInternalOrderChange(
    @CurrentCompanyId() companyId: string,
    @CurrentUser() user: JwtPayload,
    @CurrentCompanyAccess() access: CompanyAccess,
    @Args('input') input: InternalOrderChangeInput,
  ) {
    const order = await this.internalOrderService.requestChange(companyId, actorOf(user, access), input);
    return this.internalOrderService.findView(companyId, order.id);
  }

  @Mutation(() => InternalOrderObjectType)
  @RequireCompanyMembership()
  async reportInternalOrderCorrection(
    @CurrentCompanyId() companyId: string,
    @CurrentUser() user: JwtPayload,
    @CurrentCompanyAccess() access: CompanyAccess,
    @Args('orderId', { type: () => ID }) orderId: string,
    @Args('description') description: string,
  ) {
    const order = await this.internalOrderService.reportCorrection(companyId, actorOf(user, access), orderId, description);
    return this.internalOrderService.findView(companyId, order.id);
  }

  @Mutation(() => InternalOrderObjectType)
  @RequireCompanyMembership()
  async advanceInternalOrderCorrection(
    @CurrentCompanyId() companyId: string,
    @CurrentUser() user: JwtPayload,
    @CurrentCompanyAccess() access: CompanyAccess,
    @Args('orderId', { type: () => ID }) orderId: string,
  ) {
    const order = await this.internalOrderService.advanceCorrection(companyId, actorOf(user, access), orderId);
    return this.internalOrderService.findView(companyId, order.id);
  }

  @Mutation(() => InternalOrderObjectType)
  @RequireCompanyMembership()
  async nudgeInternalOrder(
    @CurrentCompanyId() companyId: string,
    @CurrentUser() user: JwtPayload,
    @CurrentCompanyAccess() access: CompanyAccess,
    @Args('orderId', { type: () => ID }) orderId: string,
    @Args('kind', { type: () => InternalOrderNudge }) kind: InternalOrderNudge,
    @Args('message', { nullable: true }) message?: string,
  ) {
    const order = await this.internalOrderService.nudge(companyId, actorOf(user, access), orderId, kind, message);
    return this.internalOrderService.findView(companyId, order.id);
  }

  // ─── Campos ────────────────────────────────────────────────────────────────────────────────
  // Todo viene cargado en la orden (ver InternalOrderService.hydrate): ninguno consulta otra vez.

  @ResolveField(() => [InternalOrderItemObjectType])
  items(@Parent() order: InternalOrderView) {
    return order.items;
  }

  @ResolveField(() => String, { nullable: true })
  sourceLocationName(@Parent() order: InternalOrderView) {
    return order.sourceLocation?.name ?? null;
  }

  @ResolveField(() => String, { nullable: true })
  sourceLocationType(@Parent() order: InternalOrderView) {
    return order.sourceLocation?.type ?? null;
  }

  @ResolveField(() => String, { nullable: true })
  destinationLocationName(@Parent() order: InternalOrderView) {
    return order.destinationLocation?.name ?? null;
  }

  @ResolveField(() => String, { nullable: true })
  destinationLocationType(@Parent() order: InternalOrderView) {
    return order.destinationLocation?.type ?? null;
  }

  @ResolveField(() => String, { nullable: true })
  requestedByName(@Parent() order: InternalOrderView) {
    return order.requestedByUser ? fullName(order.requestedByUser) : null;
  }

  @ResolveField(() => String, { nullable: true })
  warehouseOperatorName(@Parent() order: InternalOrderView) {
    return order.warehouseOperator ? fullName(order.warehouseOperator) : null;
  }

  @ResolveField(() => String, { nullable: true })
  runnerName(@Parent() order: InternalOrderView) {
    return order.runner ? fullName(order.runner) : null;
  }

  @ResolveField(() => String, { nullable: true })
  receivedByName(@Parent() order: InternalOrderView) {
    return order.receivedByUser ? fullName(order.receivedByUser) : null;
  }

  @ResolveField(() => String, { nullable: true })
  cancelledByName(@Parent() order: InternalOrderView) {
    return order.cancelledByUser ? fullName(order.cancelledByUser) : null;
  }

  @ResolveField(() => String, { nullable: true })
  parentOrderNumber(@Parent() order: InternalOrderView) {
    return order.parentOrder?.orderNumber ?? null;
  }

  @ResolveField(() => String, { nullable: true })
  relatedOrderNumber(@Parent() order: InternalOrderView) {
    return order.relatedOrder?.orderNumber ?? null;
  }

  @ResolveField(() => String, { nullable: true })
  relatedOrderStatus(@Parent() order: InternalOrderView) {
    return order.relatedOrder?.status ?? null;
  }

  @ResolveField(() => String, { nullable: true })
  saleNumber(@Parent() order: InternalOrderView) {
    return order.saleNumber;
  }

  @ResolveField(() => [InternalOrderEventObjectType])
  events(@Parent() order: InternalOrderView): InternalOrderEventObjectType[] {
    return order.events.map((event) => ({
      id: event.id,
      createdAt: event.createdAt,
      versionNumber: event.versionNumber,
      kind: event.kind,
      fromStatus: event.fromStatus,
      toStatus: event.toStatus,
      locationId: event.locationId,
      locationName: event.location?.name ?? null,
      actorId: event.actorId,
      actorName: event.actor ? fullName(event.actor) : null,
      detail: event.detail,
    }));
  }

  @ResolveField(() => [InternalOrderCorrectionObjectType])
  corrections(@Parent() order: InternalOrderView): InternalOrderCorrectionObjectType[] {
    return order.corrections.map((correction) => ({
      id: correction.id,
      createdAt: correction.createdAt,
      versionNumber: correction.versionNumber,
      description: correction.description,
      reportedByName: correction.reportedByUser ? fullName(correction.reportedByUser) : null,
      runnerName: correction.runner ? fullName(correction.runner) : null,
      step: correction.step,
      arrivedAtWarehouseAt: correction.arrivedAtWarehouseAt,
      leftWarehouseAt: correction.leftWarehouseAt,
      closedAt: correction.closedAt,
      incidentId: correction.incidentId,
    }));
  }

  // Las sub-órdenes (cambios de pedido despachados por otra bodega): solo se piden en el detalle.
  @ResolveField(() => [InternalOrderObjectType])
  subOrders(@Parent() order: InternalOrderView) {
    return this.internalOrderService.findSubOrders(order.companyId, order.id);
  }
}
