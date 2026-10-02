import { UseGuards } from '@nestjs/common';
import { Args, ID, Mutation, Query, Resolver } from '@nestjs/graphql';
import type { CompanyAccess } from '../../common/access/company-access.js';
import { CurrentCompanyAccess, CurrentCompanyId } from '../../common/decorators/current-company.decorator.js';
import { CurrentUser } from '../../common/decorators/current-user.decorator.js';
import { IdempotencyKeyHeader } from '../../common/decorators/idempotency-key.decorator.js';
import {
  RequireCompanyMembership,
  RequirePermissions,
} from '../../common/decorators/permissions.decorator.js';
import { PermissionCode } from '../../common/enums/permission-code.enum.js';
import { CsrfGuard } from '../../common/guards/csrf.guard.js';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard.js';
import { PermissionsGuard } from '../../common/guards/permissions.guard.js';
import type { JwtPayload } from '../auth/interface/jwt-payload.interface.js';
import { InternalOrderItemFoundInput } from './dto/internal-order-item-found.input.js';
import { InternalOrderItemInput } from './dto/internal-order-item.input.js';
import { InternalOrderItemObjectType } from './dto/internal-order-item.object-type.js';
import { InternalOrderObjectType } from './dto/internal-order.object-type.js';
import { RequestInternalOrderInput } from './dto/request-internal-order.input.js';
import { InternalOrderStatus } from './entities/internal-order-status.enum.js';
import { InternalOrderType } from './entities/internal-order-type.enum.js';
import { InternalOrderService } from './internal-order.service.js';

@Resolver(() => InternalOrderObjectType)
@UseGuards(JwtAuthGuard, PermissionsGuard, CsrfGuard)
export class InternalOrderResolver {
  constructor(private readonly internalOrderService: InternalOrderService) {}

  @Query(() => [InternalOrderObjectType])
  @RequireCompanyMembership()
  internalOrders(
    @CurrentCompanyId() companyId: string,
    @Args('status', { type: () => InternalOrderStatus, nullable: true }) status?: InternalOrderStatus,
    @Args('type', { type: () => InternalOrderType, nullable: true }) type?: InternalOrderType,
    @Args('runnerId', { type: () => ID, nullable: true }) runnerId?: string,
  ) {
    return this.internalOrderService.findAll(companyId, { status, type, runnerId });
  }

  @Query(() => InternalOrderObjectType)
  @RequireCompanyMembership()
  internalOrder(@CurrentCompanyId() companyId: string, @Args('id', { type: () => ID }) id: string) {
    return this.internalOrderService.findOne(companyId, id);
  }

  @Query(() => [InternalOrderItemObjectType])
  @RequireCompanyMembership()
  internalOrderItems(
    @CurrentCompanyId() companyId: string,
    @Args('internalOrderId', { type: () => ID }) internalOrderId: string,
  ) {
    return this.internalOrderService.findItems(companyId, internalOrderId);
  }

  // La lista de la que un corredor elige (ver claimInternalOrderAsRunner): no hay despachador.
  @Query(() => [InternalOrderObjectType])
  @RequirePermissions(PermissionCode.RUNNER_PICKUP_ORDERS)
  availableInternalOrdersForRunners(@CurrentCompanyId() companyId: string) {
    return this.internalOrderService.findAvailableForRunners(companyId);
  }

  @Mutation(() => InternalOrderObjectType)
  @RequirePermissions(PermissionCode.ORDERS_REQUEST_FROM_WAREHOUSE)
  requestInternalOrder(
    @CurrentCompanyId() companyId: string,
    @CurrentUser() currentUser: JwtPayload,
    @Args('input') input: RequestInternalOrderInput,
    @IdempotencyKeyHeader() idempotencyKey?: string,
  ) {
    return this.internalOrderService.request(companyId, currentUser.sub, input, idempotencyKey);
  }

  @Mutation(() => InternalOrderObjectType)
  @RequirePermissions(PermissionCode.ORDERS_REQUEST_FROM_WAREHOUSE)
  updateInternalOrderItems(
    @CurrentCompanyId() companyId: string,
    @CurrentUser() currentUser: JwtPayload,
    @Args('id', { type: () => ID }) id: string,
    @Args('items', { type: () => [InternalOrderItemInput] }) items: InternalOrderItemInput[],
  ) {
    return this.internalOrderService.updateItems(companyId, currentUser.sub, id, items);
  }

  @Mutation(() => InternalOrderObjectType)
  @RequirePermissions(PermissionCode.WAREHOUSE_FULFILL_ORDERS)
  acceptInternalOrder(
    @CurrentCompanyId() companyId: string,
    @CurrentUser() currentUser: JwtPayload,
    @Args('id', { type: () => ID }) id: string,
  ) {
    return this.internalOrderService.accept(companyId, currentUser.sub, id);
  }

  @Mutation(() => InternalOrderObjectType)
  @RequirePermissions(PermissionCode.WAREHOUSE_FULFILL_ORDERS)
  startPreparingInternalOrder(@CurrentCompanyId() companyId: string, @Args('id', { type: () => ID }) id: string) {
    return this.internalOrderService.startPreparing(companyId, id);
  }

  @Mutation(() => InternalOrderObjectType)
  @RequirePermissions(PermissionCode.WAREHOUSE_FULFILL_ORDERS)
  markInternalOrderReady(
    @CurrentCompanyId() companyId: string,
    @CurrentUser() currentUser: JwtPayload,
    @Args('id', { type: () => ID }) id: string,
    @Args('items', { type: () => [InternalOrderItemFoundInput] }) items: InternalOrderItemFoundInput[],
  ) {
    return this.internalOrderService.markReady(companyId, currentUser.sub, id, items);
  }

  @Mutation(() => InternalOrderObjectType)
  @RequirePermissions(PermissionCode.RUNNER_PICKUP_ORDERS)
  claimInternalOrderAsRunner(
    @CurrentCompanyId() companyId: string,
    @CurrentUser() currentUser: JwtPayload,
    @Args('id', { type: () => ID }) id: string,
  ) {
    return this.internalOrderService.claimAsRunner(companyId, currentUser.sub, id);
  }

  @Mutation(() => InternalOrderObjectType)
  @RequirePermissions(PermissionCode.RUNNER_PICKUP_ORDERS)
  pickUpInternalOrder(
    @CurrentCompanyId() companyId: string,
    @CurrentUser() currentUser: JwtPayload,
    @Args('id', { type: () => ID }) id: string,
  ) {
    return this.internalOrderService.pickUp(companyId, currentUser.sub, id);
  }

  @Mutation(() => InternalOrderObjectType)
  @RequirePermissions(PermissionCode.RUNNER_CONFIRM_DELIVERY)
  deliverInternalOrder(
    @CurrentCompanyId() companyId: string,
    @CurrentUser() currentUser: JwtPayload,
    @Args('id', { type: () => ID }) id: string,
  ) {
    return this.internalOrderService.deliver(companyId, currentUser.sub, id);
  }

  @Mutation(() => InternalOrderObjectType)
  @RequirePermissions(PermissionCode.ORDERS_CONFIRM_RECEIPT)
  receiveInternalOrder(
    @CurrentCompanyId() companyId: string,
    @CurrentUser() currentUser: JwtPayload,
    @Args('id', { type: () => ID }) id: string,
  ) {
    return this.internalOrderService.receive(companyId, currentUser.sub, id);
  }

  @Mutation(() => InternalOrderObjectType)
  @RequirePermissions(PermissionCode.ORDERS_CONFIRM_RECEIPT)
  completeInternalOrder(@CurrentCompanyId() companyId: string, @Args('id', { type: () => ID }) id: string) {
    return this.internalOrderService.complete(companyId, id);
  }

  // Quien lo pidió también puede cancelarlo sin el permiso de bodega (ver
  // InternalOrderService.cancel); por eso esto solo exige pertenecer a la empresa.
  @Mutation(() => InternalOrderObjectType)
  @RequireCompanyMembership()
  cancelInternalOrder(
    @CurrentCompanyId() companyId: string,
    @CurrentUser() currentUser: JwtPayload,
    @CurrentCompanyAccess() access: CompanyAccess,
    @Args('id', { type: () => ID }) id: string,
    @Args('reason', { nullable: true }) reason?: string,
  ) {
    const canFulfillOrders = access.permissionCodes.includes(PermissionCode.WAREHOUSE_FULFILL_ORDERS);
    return this.internalOrderService.cancel(companyId, { userId: currentUser.sub, canFulfillOrders }, id, reason);
  }
}
