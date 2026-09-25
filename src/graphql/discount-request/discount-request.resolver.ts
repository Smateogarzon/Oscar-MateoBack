import { UseGuards } from '@nestjs/common';
import { Args, ID, Int, Mutation, Parent, Query, ResolveField, Resolver } from '@nestjs/graphql';
import type { CompanyAccess } from '../../common/access/company-access.js';
import {
  CurrentCompanyAccess,
  CurrentCompanyId,
} from '../../common/decorators/current-company.decorator.js';
import { CurrentUser } from '../../common/decorators/current-user.decorator.js';
import { IdempotencyKeyHeader } from '../../common/decorators/idempotency-key.decorator.js';
import {
  RequireAnyPermission,
  RequirePermissions,
} from '../../common/decorators/permissions.decorator.js';
import { PermissionCode } from '../../common/enums/permission-code.enum.js';
import { CsrfGuard } from '../../common/guards/csrf.guard.js';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard.js';
import { PermissionsGuard } from '../../common/guards/permissions.guard.js';
import type { JwtPayload } from '../auth/interface/jwt-payload.interface.js';
import { saleActor } from '../sale/sale-actor.js';
import { ApproveDiscountRequestInput } from './dto/approve-discount-request.input.js';
import { DiscountRequestItemObjectType } from './dto/discount-request-item.object-type.js';
import { DiscountRequestNotesInput } from './dto/discount-request-notes.input.js';
import { DiscountRequestObjectType } from './dto/discount-request.object-type.js';
import { EditApprovedDiscountInput } from './dto/edit-approved-discount.input.js';
import { RequestDiscountInput } from './dto/request-discount.input.js';
import { DiscountRequestStatus } from './entities/discount-request-status.enum.js';
import type { DiscountRequest } from './entities/discount-request.entity.js';
import { DiscountRequestService } from './discount-request.service.js';

@Resolver(() => DiscountRequestObjectType)
@UseGuards(JwtAuthGuard, PermissionsGuard, CsrfGuard)
export class DiscountRequestResolver {
  constructor(private readonly discountRequestService: DiscountRequestService) {}

  // La lista del administrador: por ejemplo, las pendientes. Cada quien ve las solicitudes de SUS ventas y
  // las que pidió; quien ve todo o aprueba descuentos ve todas. Va acotada: `limit` (500 por defecto, 1000
  // máximo) con `offset`.
  @Query(() => [DiscountRequestObjectType])
  @RequirePermissions(PermissionCode.SALES_VIEW)
  discountRequests(
    @CurrentCompanyId() companyId: string,
    @CurrentCompanyAccess() access: CompanyAccess,
    @CurrentUser() currentUser: JwtPayload,
    @Args('status', { type: () => DiscountRequestStatus, nullable: true })
    status?: DiscountRequestStatus,
    @Args('saleId', { type: () => ID, nullable: true }) saleId?: string,
    @Args('limit', { type: () => Int, nullable: true }) limit?: number,
    @Args('offset', { type: () => Int, nullable: true }) offset?: number,
  ) {
    return this.discountRequestService.findAll(
      companyId,
      saleActor(currentUser.sub, access.permissionCodes),
      { status, saleId, limit, offset },
    );
  }

  @Query(() => DiscountRequestObjectType)
  @RequirePermissions(PermissionCode.SALES_VIEW)
  discountRequest(
    @CurrentCompanyId() companyId: string,
    @CurrentCompanyAccess() access: CompanyAccess,
    @CurrentUser() currentUser: JwtPayload,
    @Args('id', { type: () => ID }) id: string,
  ) {
    return this.discountRequestService.findOne(
      companyId,
      saleActor(currentUser.sub, access.permissionCodes),
      id,
    );
  }

  // El número de la venta: ya viene cargado en las listas; en una solicitud suelta se busca.
  @ResolveField(() => String, { nullable: true })
  saleNumber(@Parent() request: DiscountRequestObjectType) {
    return this.discountRequestService.saleNumberOf(request as unknown as DiscountRequest);
  }

  // Los montos por línea de una solicitud (vacío si es sobre toda la venta). Va como consulta
  // aparte y no como campo de DiscountRequest para no repetir los guards por cada solicitud de
  // un listado.
  @Query(() => [DiscountRequestItemObjectType])
  @RequirePermissions(PermissionCode.SALES_VIEW)
  discountRequestItems(
    @CurrentCompanyId() companyId: string,
    @CurrentCompanyAccess() access: CompanyAccess,
    @CurrentUser() currentUser: JwtPayload,
    @Args('requestId', { type: () => ID }) requestId: string,
  ) {
    return this.discountRequestService.findItems(
      companyId,
      saleActor(currentUser.sub, access.permissionCodes),
      requestId,
    );
  }

  // El cajero pide el descuento mientras arma la venta: no hace falta poder aprobarlo. Solo el cajero
  // de esa venta puede pedirlo.
  @Mutation(() => DiscountRequestObjectType)
  @RequirePermissions(PermissionCode.SALES_CREATE)
  requestDiscount(
    @CurrentCompanyId() companyId: string,
    @CurrentUser() currentUser: JwtPayload,
    @Args('input') input: RequestDiscountInput,
    @IdempotencyKeyHeader() idempotencyKey?: string,
  ) {
    return this.discountRequestService.request(companyId, currentUser.sub, input, idempotencyKey);
  }

  @Mutation(() => DiscountRequestObjectType)
  @RequirePermissions(PermissionCode.SALES_APPROVE_DISCOUNT)
  approveDiscountRequest(
    @CurrentCompanyId() companyId: string,
    @CurrentUser() currentUser: JwtPayload,
    @Args('id', { type: () => ID }) id: string,
    @Args('input') input: ApproveDiscountRequestInput,
    @IdempotencyKeyHeader() idempotencyKey?: string,
  ) {
    return this.discountRequestService.approve(companyId, currentUser.sub, id, input, idempotencyKey);
  }

  // Un administrador cambia los montos de un descuento ya aprobado (no las líneas), dentro del
  // tope del 30 %, mientras la venta siga en borrador.
  @Mutation(() => DiscountRequestObjectType)
  @RequirePermissions(PermissionCode.SALES_APPROVE_DISCOUNT)
  editApprovedDiscount(
    @CurrentCompanyId() companyId: string,
    @CurrentUser() currentUser: JwtPayload,
    @Args('id', { type: () => ID }) id: string,
    @Args('input') input: EditApprovedDiscountInput,
    @IdempotencyKeyHeader() idempotencyKey?: string,
  ) {
    return this.discountRequestService.editApproved(
      companyId,
      currentUser.sub,
      id,
      input,
      idempotencyKey,
    );
  }

  @Mutation(() => DiscountRequestObjectType)
  @RequirePermissions(PermissionCode.SALES_APPROVE_DISCOUNT)
  rejectDiscountRequest(
    @CurrentCompanyId() companyId: string,
    @CurrentUser() currentUser: JwtPayload,
    @Args('id', { type: () => ID }) id: string,
    @Args('input') input: DiscountRequestNotesInput,
    @IdempotencyKeyHeader() idempotencyKey?: string,
  ) {
    return this.discountRequestService.reject(companyId, currentUser.sub, id, input, idempotencyKey);
  }

  // Quien la pidió (con sales.create) o quien aprueba descuentos: el servicio comprueba cuál.
  @Mutation(() => DiscountRequestObjectType)
  @RequireAnyPermission(PermissionCode.SALES_CREATE, PermissionCode.SALES_APPROVE_DISCOUNT)
  cancelDiscountRequest(
    @CurrentCompanyId() companyId: string,
    @CurrentCompanyAccess() access: CompanyAccess,
    @CurrentUser() currentUser: JwtPayload,
    @Args('id', { type: () => ID }) id: string,
    @Args('input') input: DiscountRequestNotesInput,
  ) {
    const canApprove = access.permissionCodes.includes(PermissionCode.SALES_APPROVE_DISCOUNT);
    return this.discountRequestService.cancel(companyId, currentUser.sub, id, canApprove, input);
  }
}
