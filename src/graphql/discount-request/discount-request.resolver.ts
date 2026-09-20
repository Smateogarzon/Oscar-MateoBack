import { UseGuards } from '@nestjs/common';
import { Args, ID, Mutation, Query, Resolver } from '@nestjs/graphql';
import type { CompanyAccess } from '../../common/access/company-access.js';
import {
  CurrentCompanyAccess,
  CurrentCompanyId,
} from '../../common/decorators/current-company.decorator.js';
import { CurrentUser } from '../../common/decorators/current-user.decorator.js';
import {
  RequireAnyPermission,
  RequirePermissions,
} from '../../common/decorators/permissions.decorator.js';
import { PermissionCode } from '../../common/enums/permission-code.enum.js';
import { CsrfGuard } from '../../common/guards/csrf.guard.js';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard.js';
import { PermissionsGuard } from '../../common/guards/permissions.guard.js';
import type { JwtPayload } from '../auth/interface/jwt-payload.interface.js';
import { ApproveDiscountRequestInput } from './dto/approve-discount-request.input.js';
import { DiscountRequestItemObjectType } from './dto/discount-request-item.object-type.js';
import { DiscountRequestNotesInput } from './dto/discount-request-notes.input.js';
import { DiscountRequestObjectType } from './dto/discount-request.object-type.js';
import { EditApprovedDiscountInput } from './dto/edit-approved-discount.input.js';
import { RequestDiscountInput } from './dto/request-discount.input.js';
import { DiscountRequestStatus } from './entities/discount-request-status.enum.js';
import { DiscountRequestService } from './discount-request.service.js';

@Resolver(() => DiscountRequestObjectType)
@UseGuards(JwtAuthGuard, PermissionsGuard, CsrfGuard)
export class DiscountRequestResolver {
  constructor(private readonly discountRequestService: DiscountRequestService) {}

  // La lista del administrador: por ejemplo, las pendientes.
  @Query(() => [DiscountRequestObjectType])
  @RequirePermissions(PermissionCode.SALES_VIEW)
  discountRequests(
    @CurrentCompanyId() companyId: string,
    @Args('status', { type: () => DiscountRequestStatus, nullable: true })
    status?: DiscountRequestStatus,
    @Args('saleId', { type: () => ID, nullable: true }) saleId?: string,
  ) {
    return this.discountRequestService.findAll(companyId, { status, saleId });
  }

  @Query(() => DiscountRequestObjectType)
  @RequirePermissions(PermissionCode.SALES_VIEW)
  discountRequest(
    @CurrentCompanyId() companyId: string,
    @Args('id', { type: () => ID }) id: string,
  ) {
    return this.discountRequestService.findOne(companyId, id);
  }

  // Los montos por línea de una solicitud (vacío si es sobre toda la venta). Va como consulta
  // aparte y no como campo de DiscountRequest para no repetir los guards por cada solicitud de
  // un listado.
  @Query(() => [DiscountRequestItemObjectType])
  @RequirePermissions(PermissionCode.SALES_VIEW)
  discountRequestItems(
    @CurrentCompanyId() companyId: string,
    @Args('requestId', { type: () => ID }) requestId: string,
  ) {
    return this.discountRequestService.findItems(companyId, requestId);
  }

  // El cajero pide el descuento mientras arma la venta: no hace falta poder aprobarlo.
  @Mutation(() => DiscountRequestObjectType)
  @RequirePermissions(PermissionCode.SALES_CREATE)
  requestDiscount(
    @CurrentCompanyId() companyId: string,
    @CurrentUser() currentUser: JwtPayload,
    @Args('input') input: RequestDiscountInput,
  ) {
    return this.discountRequestService.request(companyId, currentUser.sub, input);
  }

  @Mutation(() => DiscountRequestObjectType)
  @RequirePermissions(PermissionCode.SALES_APPROVE_DISCOUNT)
  approveDiscountRequest(
    @CurrentCompanyId() companyId: string,
    @CurrentUser() currentUser: JwtPayload,
    @Args('id', { type: () => ID }) id: string,
    @Args('input') input: ApproveDiscountRequestInput,
  ) {
    return this.discountRequestService.approve(companyId, currentUser.sub, id, input);
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
  ) {
    return this.discountRequestService.editApproved(companyId, currentUser.sub, id, input);
  }

  @Mutation(() => DiscountRequestObjectType)
  @RequirePermissions(PermissionCode.SALES_APPROVE_DISCOUNT)
  rejectDiscountRequest(
    @CurrentCompanyId() companyId: string,
    @CurrentUser() currentUser: JwtPayload,
    @Args('id', { type: () => ID }) id: string,
    @Args('input') input: DiscountRequestNotesInput,
  ) {
    return this.discountRequestService.reject(companyId, currentUser.sub, id, input);
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
