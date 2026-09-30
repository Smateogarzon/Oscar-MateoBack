import { UseGuards } from '@nestjs/common';
import { Args, ID, Mutation, Parent, Query, ResolveField, Resolver } from '@nestjs/graphql';
import type { CompanyAccess } from '../../common/access/company-access.js';
import { CurrentCompanyAccess, CurrentCompanyId } from '../../common/decorators/current-company.decorator.js';
import { CurrentUser } from '../../common/decorators/current-user.decorator.js';
import { IdempotencyKeyHeader } from '../../common/decorators/idempotency-key.decorator.js';
import { RequireAnyPermission, RequirePermissions } from '../../common/decorators/permissions.decorator.js';
import { PermissionCode } from '../../common/enums/permission-code.enum.js';
import { CsrfGuard } from '../../common/guards/csrf.guard.js';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard.js';
import { PermissionsGuard } from '../../common/guards/permissions.guard.js';
import type { JwtPayload } from '../auth/interface/jwt-payload.interface.js';
import { ProductDeletionRequestNotesInput } from './dto/product-deletion-request-notes.input.js';
import { ProductDeletionRequestObjectType } from './dto/product-deletion-request.object-type.js';
import { RequestProductDeletionInput } from './dto/request-product-deletion.input.js';
import { ProductDeletionRequestStatus } from './entities/product-deletion-request-status.enum.js';
import type { ProductDeletionRequest } from './entities/product-deletion-request.entity.js';
import { ProductDeletionRequestService, type ProductDeletionRequestActor } from './product-deletion-request.service.js';

const REQUEST_OR_MANAGE = [PermissionCode.INVENTORY_REQUEST_DELETION, PermissionCode.INVENTORY_MANAGE_PRODUCTS];

@Resolver(() => ProductDeletionRequestObjectType)
@UseGuards(JwtAuthGuard, PermissionsGuard, CsrfGuard)
export class ProductDeletionRequestResolver {
  constructor(private readonly requestService: ProductDeletionRequestService) {}

  @Query(() => [ProductDeletionRequestObjectType])
  @RequireAnyPermission(...REQUEST_OR_MANAGE)
  productDeletionRequests(
    @CurrentCompanyId() companyId: string,
    @CurrentCompanyAccess() access: CompanyAccess,
    @CurrentUser() currentUser: JwtPayload,
    @Args('status', { type: () => ProductDeletionRequestStatus, nullable: true }) status?: ProductDeletionRequestStatus,
  ) {
    return this.requestService.findAll(companyId, this.actorOf(currentUser, access), { status });
  }

  @Query(() => ProductDeletionRequestObjectType)
  @RequireAnyPermission(...REQUEST_OR_MANAGE)
  productDeletionRequest(
    @CurrentCompanyId() companyId: string,
    @CurrentCompanyAccess() access: CompanyAccess,
    @CurrentUser() currentUser: JwtPayload,
    @Args('id', { type: () => ID }) id: string,
  ) {
    return this.requestService.findOne(companyId, this.actorOf(currentUser, access), id);
  }

  // La referencia (código de estilo) del producto: ya viene cargada en las listas; en una
  // solicitud suelta se busca.
  @ResolveField(() => String, { nullable: true })
  productReference(@Parent() request: ProductDeletionRequestObjectType) {
    return this.requestService.productReferenceOf(request as unknown as ProductDeletionRequest);
  }

  // Quien no puede borrar directo la pide.
  @Mutation(() => ProductDeletionRequestObjectType)
  @RequireAnyPermission(...REQUEST_OR_MANAGE)
  requestProductDeletion(
    @CurrentCompanyId() companyId: string,
    @CurrentUser() currentUser: JwtPayload,
    @Args('input') input: RequestProductDeletionInput,
    @IdempotencyKeyHeader() idempotencyKey?: string,
  ) {
    return this.requestService.request(companyId, currentUser.sub, input, idempotencyKey);
  }

  @Mutation(() => ProductDeletionRequestObjectType)
  @RequirePermissions(PermissionCode.INVENTORY_MANAGE_PRODUCTS)
  approveProductDeletionRequest(
    @CurrentCompanyId() companyId: string,
    @CurrentCompanyAccess() access: CompanyAccess,
    @CurrentUser() currentUser: JwtPayload,
    @Args('id', { type: () => ID }) id: string,
    @Args('input') input: ProductDeletionRequestNotesInput,
    @IdempotencyKeyHeader() idempotencyKey?: string,
  ) {
    return this.requestService.approve(companyId, currentUser.sub, id, access.roleCodes, input, idempotencyKey);
  }

  @Mutation(() => ProductDeletionRequestObjectType)
  @RequirePermissions(PermissionCode.INVENTORY_MANAGE_PRODUCTS)
  rejectProductDeletionRequest(
    @CurrentCompanyId() companyId: string,
    @CurrentUser() currentUser: JwtPayload,
    @Args('id', { type: () => ID }) id: string,
    @Args('input') input: ProductDeletionRequestNotesInput,
    @IdempotencyKeyHeader() idempotencyKey?: string,
  ) {
    return this.requestService.reject(companyId, currentUser.sub, id, input, idempotencyKey);
  }

  // Quien la pidió (con inventory.request_deletion) o quien la puede aprobar: el servicio
  // comprueba cuál.
  @Mutation(() => ProductDeletionRequestObjectType)
  @RequireAnyPermission(...REQUEST_OR_MANAGE)
  cancelProductDeletionRequest(
    @CurrentCompanyId() companyId: string,
    @CurrentCompanyAccess() access: CompanyAccess,
    @CurrentUser() currentUser: JwtPayload,
    @Args('id', { type: () => ID }) id: string,
    @Args('input') input: ProductDeletionRequestNotesInput,
  ) {
    const canApprove = access.permissionCodes.includes(PermissionCode.INVENTORY_MANAGE_PRODUCTS);
    return this.requestService.cancel(companyId, currentUser.sub, id, canApprove, input);
  }

  private actorOf(currentUser: JwtPayload, access: CompanyAccess): ProductDeletionRequestActor {
    return {
      userId: currentUser.sub,
      canReadAll: access.permissionCodes.includes(PermissionCode.INVENTORY_MANAGE_PRODUCTS),
    };
  }
}
