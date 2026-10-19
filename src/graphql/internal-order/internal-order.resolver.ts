import { UseGuards } from '@nestjs/common';
import { Args, ID, Mutation, Parent, Query, ResolveField, Resolver } from '@nestjs/graphql';
import { isCompanyAdmin, type CompanyAccess } from '../../common/access/company-access.js';
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
import { IncidentObjectType } from '../incident/dto/incident.object-type.js';
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
import { ReportInternalOrderIncidentInput } from './dto/report-internal-order-incident.input.js';
import { RequestInternalOrderInput } from './dto/request-internal-order.input.js';
import { CreateReturnFromBinInput, ReturnsBinLineObjectType } from './dto/returns-bin.dto.js';
import { TransitionInternalOrderInput } from './dto/transition-internal-order.input.js';
import { InternalOrderNudge } from './entities/internal-order-nudge.enum.js';
import { InternalOrderService, type InternalOrderView, type OrderActor } from './internal-order.service.js';

// Quien opera, con sus permisos en la empresa activa. El super admin lo puede todo (también hacer un
// paso por el corredor asignado); anular es solo del administrador.
const actorOf = (user: JwtPayload, access: CompanyAccess): OrderActor => ({
  userId: user.sub,
  permissionCodes: access.permissionCodes,
  isSuperAdmin: access.roleCodes.includes(RoleCode.SUPER_ADMIN),
  isAdmin: isCompanyAdmin(access),
});

// Las consultas solo piden pertenecer a la empresa: QUÉ órdenes ve cada quien lo decide el servicio
// por permisos (ver internal-order-visibility.ts), también para moverlas. Las mutaciones se validan
// allá, paso por paso, con la tabla del flujo.
@Resolver(() => InternalOrderObjectType)
@UseGuards(JwtAuthGuard, PermissionsGuard, CsrfGuard)
export class InternalOrderResolver {
  constructor(private readonly internalOrderService: InternalOrderService) {}

  // Leer pedidos exige orders.view (la sección de Pedidos) o cash.charge_orders: la caja no entra a
  // Pedidos, pero cobra las órdenes que el vendedor le manda y necesita verlas en su pantalla de Venta.
  // Lo que cada quien ve dentro (todas, las de su bodega, las que lleva o puede tomar, las que pidió o
  // las que llegan a su sede) lo decide internal-order-visibility.ts.
  @Query(() => [InternalOrderObjectType])
  @RequireAnyPermission(PermissionCode.ORDERS_VIEW, PermissionCode.CASH_CHARGE_ORDERS)
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

  // Devuelve una lista: lo que un vendedor pide puede estar repartido en varias bodegas, y entonces
  // nace una orden por bodega (ver `InternalOrderService.request`). Un pedido de una sola bodega, y
  // cualquier transferencia, devuelve una sola.
  @Mutation(() => [InternalOrderObjectType])
  @RequireAnyPermission(PermissionCode.ORDERS_REQUEST_FROM_WAREHOUSE, PermissionCode.INVENTORY_TRANSFER, PermissionCode.WAREHOUSE_FULFILL_ORDERS)
  async requestInternalOrder(
    @CurrentCompanyId() companyId: string,
    @CurrentUser() user: JwtPayload,
    @CurrentCompanyAccess() access: CompanyAccess,
    @Args('input') input: RequestInternalOrderInput,
    @IdempotencyKeyHeader() idempotencyKey?: string,
  ) {
    const orders = await this.internalOrderService.request(companyId, actorOf(user, access), input, idempotencyKey);
    return Promise.all(orders.map((order) => this.internalOrderService.findView(companyId, order.id)));
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
    @Args('itemIds', { type: () => [ID] }) itemIds: string[],
    @Args('description') description: string,
  ) {
    const order = await this.internalOrderService.reportCorrection(companyId, actorOf(user, access), orderId, itemIds, description);
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

  // El corredor toma una orden que espera en bodega (antes de recogerla).
  @Mutation(() => InternalOrderObjectType)
  @RequirePermissions(PermissionCode.RUNNER_PICKUP_ORDERS)
  async claimInternalOrder(
    @CurrentCompanyId() companyId: string,
    @CurrentUser() user: JwtPayload,
    @CurrentCompanyAccess() access: CompanyAccess,
    @Args('orderId', { type: () => ID }) orderId: string,
  ) {
    const order = await this.internalOrderService.claim(companyId, actorOf(user, access), orderId);
    return this.internalOrderService.findView(companyId, order.id);
  }

  // ─── Cajón de devoluciones (solo el administrador) ──────────────────────────────────────────

  @Query(() => [ReturnsBinLineObjectType])
  @RequireCompanyMembership()
  returnsBin(@CurrentCompanyId() companyId: string, @CurrentUser() user: JwtPayload, @CurrentCompanyAccess() access: CompanyAccess) {
    return this.internalOrderService.returnsBinContents(companyId, actorOf(user, access));
  }

  // Devuelve una lista: lo marcado puede haber salido de varias bodegas y entonces nace una RE por
  // bodega (ver `InternalOrderService.createReturnFromBin`).
  @Mutation(() => [InternalOrderObjectType])
  @RequireCompanyMembership()
  async createReturnFromBin(
    @CurrentCompanyId() companyId: string,
    @CurrentUser() user: JwtPayload,
    @CurrentCompanyAccess() access: CompanyAccess,
    @Args('input') input: CreateReturnFromBinInput,
  ) {
    const orders = await this.internalOrderService.createReturnFromBin(companyId, actorOf(user, access), input);
    return Promise.all(orders.map((order) => this.internalOrderService.findView(companyId, order.id)));
  }

  // El corredor responde dónde va (a "Contactar al corredor").
  @Mutation(() => InternalOrderObjectType)
  @RequireAnyPermission(PermissionCode.RUNNER_PICKUP_ORDERS, PermissionCode.RUNNER_CONFIRM_DELIVERY)
  async replyAsRunner(
    @CurrentCompanyId() companyId: string,
    @CurrentUser() user: JwtPayload,
    @CurrentCompanyAccess() access: CompanyAccess,
    @Args('orderId', { type: () => ID }) orderId: string,
    @Args('message') message: string,
  ) {
    const order = await this.internalOrderService.runnerReply(companyId, actorOf(user, access), orderId, message.slice(0, 300));
    return this.internalOrderService.findView(companyId, order.id);
  }

  @Mutation(() => InternalOrderObjectType)
  @RequireAnyPermission(PermissionCode.RUNNER_REPORT_INCIDENT, PermissionCode.ORDERS_CONFIRM_RECEIPT, PermissionCode.WAREHOUSE_FULFILL_ORDERS)
  async reportInternalOrderIncident(
    @CurrentCompanyId() companyId: string,
    @CurrentUser() user: JwtPayload,
    @CurrentCompanyAccess() access: CompanyAccess,
    @Args('input') input: ReportInternalOrderIncidentInput,
  ) {
    const order = await this.internalOrderService.reportIncident(companyId, actorOf(user, access), input);
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
      items: correction.items,
      reportedByName: correction.reportedByUser ? fullName(correction.reportedByUser) : null,
      runnerName: correction.runner ? fullName(correction.runner) : null,
      step: correction.step,
      arrivedAtWarehouseAt: correction.arrivedAtWarehouseAt,
      leftWarehouseAt: correction.leftWarehouseAt,
      closedAt: correction.closedAt,
      incidentId: correction.incidentId,
    }));
  }

  // Las novedades de la orden y de sus líneas: las ve quien ve la orden.
  @ResolveField(() => [IncidentObjectType])
  incidents(@Parent() order: InternalOrderView) {
    return order.incidents;
  }

  // Las sub-órdenes (cambios de pedido despachados por otra bodega): solo se piden en el detalle.
  @ResolveField(() => [InternalOrderObjectType])
  subOrders(@Parent() order: InternalOrderView) {
    return this.internalOrderService.findSubOrders(order.companyId, order.id);
  }
}
