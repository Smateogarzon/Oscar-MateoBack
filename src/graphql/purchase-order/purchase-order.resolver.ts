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
import { RoleCode } from '../../common/enums/role-code.enum.js';
import { CsrfGuard } from '../../common/guards/csrf.guard.js';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard.js';
import { PermissionsGuard } from '../../common/guards/permissions.guard.js';
import type { JwtPayload } from '../auth/interface/jwt-payload.interface.js';
import { CreatePurchaseOrderInput } from './dto/create-purchase-order.input.js';
import { PurchaseOrderItemCountInput } from './dto/purchase-order-item-count.input.js';
import { PurchaseOrderItemObjectType } from './dto/purchase-order-item.object-type.js';
import { PurchaseOrderOverageDecisionInput } from './dto/purchase-order-overage-decision.input.js';
import { PurchaseOrderObjectType } from './dto/purchase-order.object-type.js';
import { PurchaseOrderStatus } from './entities/purchase-order-status.enum.js';
import { PurchaseOrderService } from './purchase-order.service.js';

// El proveedor ve y toca SOLO sus órdenes, tenga el permiso que tenga: devuelve a qué proveedor se
// acota lo que pide, o undefined para quien no es proveedor (el administrador y el super admin ven
// las de toda la empresa). Va acá y no en el permiso porque es el rol, no el permiso, el que dice
// "estas órdenes son tuyas": el proveedor con suppliers.manage_purchase_orders arma las suyas, no
// las de otro proveedor.
const supplierScopeOf = (access: CompanyAccess, userId: string): string | undefined =>
  access.roleCodes.includes(RoleCode.SUPPLIER) ? userId : undefined;

@Resolver(() => PurchaseOrderObjectType)
@UseGuards(JwtAuthGuard, PermissionsGuard, CsrfGuard)
export class PurchaseOrderResolver {
  constructor(private readonly purchaseOrderService: PurchaseOrderService) {}

  @Query(() => [PurchaseOrderObjectType])
  @RequireCompanyMembership()
  purchaseOrders(
    @CurrentCompanyId() companyId: string,
    @CurrentUser() currentUser: JwtPayload,
    @CurrentCompanyAccess() access: CompanyAccess,
    @Args('status', { type: () => PurchaseOrderStatus, nullable: true }) status?: PurchaseOrderStatus,
    @Args('supplierId', { type: () => ID, nullable: true }) supplierId?: string,
  ) {
    const scope = supplierScopeOf(access, currentUser.sub);
    return this.purchaseOrderService.findAll(companyId, { status, supplierId: scope ?? supplierId });
  }

  @Query(() => PurchaseOrderObjectType)
  @RequireCompanyMembership()
  purchaseOrder(
    @CurrentCompanyId() companyId: string,
    @CurrentUser() currentUser: JwtPayload,
    @CurrentCompanyAccess() access: CompanyAccess,
    @Args('id', { type: () => ID }) id: string,
  ) {
    return this.purchaseOrderService.findOne(companyId, id, supplierScopeOf(access, currentUser.sub));
  }

  @Query(() => [PurchaseOrderItemObjectType])
  @RequireCompanyMembership()
  purchaseOrderItems(
    @CurrentCompanyId() companyId: string,
    @CurrentUser() currentUser: JwtPayload,
    @CurrentCompanyAccess() access: CompanyAccess,
    @Args('purchaseOrderId', { type: () => ID }) purchaseOrderId: string,
  ) {
    return this.purchaseOrderService.findItems(
      companyId,
      purchaseOrderId,
      supplierScopeOf(access, currentUser.sub),
    );
  }

  // El proveedor arma la orden a su propio nombre: lo que venga en `input.supplierId` no cuenta,
  // nadie pide mercancía en nombre de otro proveedor.
  @Mutation(() => PurchaseOrderObjectType)
  @RequirePermissions(PermissionCode.SUPPLIERS_MANAGE_PURCHASE_ORDERS)
  createPurchaseOrder(
    @CurrentCompanyId() companyId: string,
    @CurrentUser() currentUser: JwtPayload,
    @CurrentCompanyAccess() access: CompanyAccess,
    @Args('input') input: CreatePurchaseOrderInput,
    @IdempotencyKeyHeader() idempotencyKey?: string,
  ) {
    const scope = supplierScopeOf(access, currentUser.sub);
    return this.purchaseOrderService.create(
      companyId,
      currentUser.sub,
      scope ? { ...input, supplierId: scope } : input,
      idempotencyKey,
    );
  }

  @Mutation(() => PurchaseOrderObjectType)
  @RequirePermissions(PermissionCode.SUPPLIERS_MANAGE_PURCHASE_ORDERS)
  sendPurchaseOrder(
    @CurrentCompanyId() companyId: string,
    @CurrentUser() currentUser: JwtPayload,
    @CurrentCompanyAccess() access: CompanyAccess,
    @Args('id', { type: () => ID }) id: string,
  ) {
    return this.purchaseOrderService.send(companyId, currentUser.sub, id, supplierScopeOf(access, currentUser.sub));
  }

  // El proveedor cuenta lo que manda de CADA línea y despacha: van todas, y la que no tenga va en
  // 0 (ahí nace su novedad). Despachar no mete nada al inventario.
  @Mutation(() => PurchaseOrderObjectType)
  @RequirePermissions(PermissionCode.SUPPLIERS_REGISTER_DELIVERY)
  shipPurchaseOrder(
    @CurrentCompanyId() companyId: string,
    @CurrentUser() currentUser: JwtPayload,
    @Args('id', { type: () => ID }) id: string,
    @Args('items', { type: () => [PurchaseOrderItemCountInput] }) items: PurchaseOrderItemCountInput[],
  ) {
    return this.purchaseOrderService.ship(companyId, currentUser.sub, id, items);
  }

  // El administrador autoriza (o rechaza) el sobrante que mandó el proveedor, línea por línea.
  // Exige el permiso de compras, y el servicio además impide que lo haga el proveedor de la orden.
  @Mutation(() => PurchaseOrderObjectType)
  @RequirePermissions(PermissionCode.SUPPLIERS_MANAGE_PURCHASE_ORDERS)
  resolvePurchaseOrderOverage(
    @CurrentCompanyId() companyId: string,
    @CurrentUser() currentUser: JwtPayload,
    @Args('id', { type: () => ID }) id: string,
    @Args('decisions', { type: () => [PurchaseOrderOverageDecisionInput] }) decisions: PurchaseOrderOverageDecisionInput[],
  ) {
    return this.purchaseOrderService.resolveOverage(companyId, currentUser.sub, id, decisions);
  }

  // El bodeguero cuenta lo que llegó y acepta la orden: con el mismo permiso con el que bodega
  // alista y despacha pedidos. Lo que él cuenta es lo que entra al inventario.
  @Mutation(() => PurchaseOrderObjectType)
  @RequirePermissions(PermissionCode.WAREHOUSE_FULFILL_ORDERS)
  receivePurchaseOrder(
    @CurrentCompanyId() companyId: string,
    @CurrentUser() currentUser: JwtPayload,
    @Args('id', { type: () => ID }) id: string,
    @Args('items', { type: () => [PurchaseOrderItemCountInput] }) items: PurchaseOrderItemCountInput[],
  ) {
    return this.purchaseOrderService.receive(companyId, currentUser.sub, id, items);
  }

  // Quien gestiona las compras de la empresa o el proveedor de la orden pueden cancelarla; por eso
  // esto solo exige pertenecer a la empresa, y el servicio decide. Al proveedor no se le cuenta como
  // "gestiona compras" aunque tenga el permiso: así solo cancela las suyas, por ser su proveedor.
  @Mutation(() => PurchaseOrderObjectType)
  @RequireCompanyMembership()
  cancelPurchaseOrder(
    @CurrentCompanyId() companyId: string,
    @CurrentUser() currentUser: JwtPayload,
    @CurrentCompanyAccess() access: CompanyAccess,
    @Args('id', { type: () => ID }) id: string,
    @Args('reason', { nullable: true }) reason?: string,
  ) {
    const canManagePurchasing =
      !supplierScopeOf(access, currentUser.sub) &&
      access.permissionCodes.includes(PermissionCode.SUPPLIERS_MANAGE_PURCHASE_ORDERS);
    return this.purchaseOrderService.cancel(
      companyId,
      { userId: currentUser.sub, canManagePurchasing },
      id,
      reason,
    );
  }
}
