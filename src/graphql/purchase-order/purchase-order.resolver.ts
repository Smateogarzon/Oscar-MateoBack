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
import { CreatePurchaseOrderInput } from './dto/create-purchase-order.input.js';
import { PurchaseOrderObjectType } from './dto/purchase-order.object-type.js';
import { PurchaseOrderStatus } from './entities/purchase-order-status.enum.js';
import { PurchaseOrderService } from './purchase-order.service.js';

@Resolver(() => PurchaseOrderObjectType)
@UseGuards(JwtAuthGuard, PermissionsGuard, CsrfGuard)
export class PurchaseOrderResolver {
  constructor(private readonly purchaseOrderService: PurchaseOrderService) {}

  @Query(() => [PurchaseOrderObjectType])
  @RequireCompanyMembership()
  purchaseOrders(
    @CurrentCompanyId() companyId: string,
    @Args('status', { type: () => PurchaseOrderStatus, nullable: true }) status?: PurchaseOrderStatus,
    @Args('supplierId', { type: () => ID, nullable: true }) supplierId?: string,
  ) {
    return this.purchaseOrderService.findAll(companyId, { status, supplierId });
  }

  @Query(() => PurchaseOrderObjectType)
  @RequireCompanyMembership()
  purchaseOrder(@CurrentCompanyId() companyId: string, @Args('id', { type: () => ID }) id: string) {
    return this.purchaseOrderService.findOne(companyId, id);
  }

  @Mutation(() => PurchaseOrderObjectType)
  @RequirePermissions(PermissionCode.INVENTORY_MANAGE_PRODUCTS)
  createPurchaseOrder(
    @CurrentCompanyId() companyId: string,
    @CurrentUser() currentUser: JwtPayload,
    @Args('input') input: CreatePurchaseOrderInput,
    @IdempotencyKeyHeader() idempotencyKey?: string,
  ) {
    return this.purchaseOrderService.create(companyId, currentUser.sub, input, idempotencyKey);
  }

  @Mutation(() => PurchaseOrderObjectType)
  @RequirePermissions(PermissionCode.INVENTORY_MANAGE_PRODUCTS)
  sendPurchaseOrder(@CurrentCompanyId() companyId: string, @Args('id', { type: () => ID }) id: string) {
    return this.purchaseOrderService.send(companyId, id);
  }

  @Mutation(() => PurchaseOrderObjectType)
  @RequirePermissions(PermissionCode.SUPPLIERS_CONFIRM_PURCHASE_ORDER)
  confirmPurchaseOrder(
    @CurrentCompanyId() companyId: string,
    @CurrentUser() currentUser: JwtPayload,
    @Args('id', { type: () => ID }) id: string,
  ) {
    return this.purchaseOrderService.confirm(companyId, currentUser.sub, id);
  }

  @Mutation(() => PurchaseOrderObjectType)
  @RequirePermissions(PermissionCode.SUPPLIERS_REGISTER_DELIVERY)
  registerPurchaseOrderDelivery(
    @CurrentCompanyId() companyId: string,
    @CurrentUser() currentUser: JwtPayload,
    @Args('id', { type: () => ID }) id: string,
    @Args('partial', { type: () => Boolean, defaultValue: false }) partial: boolean,
  ) {
    return this.purchaseOrderService.registerDelivery(companyId, currentUser.sub, id, partial);
  }

  // Quien la creó (en la práctica, siempre tiene inventory.manage_products) o el proveedor de la
  // orden pueden cancelarla; por eso esto solo exige pertenecer a la empresa, y el servicio decide.
  @Mutation(() => PurchaseOrderObjectType)
  @RequireCompanyMembership()
  cancelPurchaseOrder(
    @CurrentCompanyId() companyId: string,
    @CurrentUser() currentUser: JwtPayload,
    @CurrentCompanyAccess() access: CompanyAccess,
    @Args('id', { type: () => ID }) id: string,
    @Args('reason', { nullable: true }) reason?: string,
  ) {
    const canManagePurchasing = access.permissionCodes.includes(PermissionCode.INVENTORY_MANAGE_PRODUCTS);
    return this.purchaseOrderService.cancel(
      companyId,
      { userId: currentUser.sub, canManagePurchasing },
      id,
      reason,
    );
  }
}
