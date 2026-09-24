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
import { cashActor } from '../cash-session/cash-actor.js';
import { CompleteReturnRefundInput } from './dto/complete-return-refund.input.js';
import { EditSaleReturnInput } from './dto/edit-sale-return.input.js';
import { RefundPaymentObjectType } from './dto/refund-payment.object-type.js';
import { RequestSaleReturnInput } from './dto/request-sale-return.input.js';
import { SaleReturnItemObjectType } from './dto/sale-return-item.object-type.js';
import { SaleReturnNotesInput } from './dto/sale-return-notes.input.js';
import { SaleReturnObjectType } from './dto/sale-return.object-type.js';
import { SessionRefundObjectType } from './dto/session-refund.object-type.js';
import { SaleReturnStatus } from './entities/sale-return-status.enum.js';
import { SaleReturnService } from './sale-return.service.js';

@Resolver(() => SaleReturnObjectType)
@UseGuards(JwtAuthGuard, PermissionsGuard, CsrfGuard)
export class SaleReturnResolver {
  constructor(private readonly saleReturnService: SaleReturnService) {}

  // Se puede consultar desde la venta original (`saleId`) o desde la venta nueva de un cambio
  // (`replacementSaleId`).
  @Query(() => [SaleReturnObjectType])
  @RequirePermissions(PermissionCode.SALES_VIEW)
  saleReturns(
    @CurrentCompanyId() companyId: string,
    @Args('status', { type: () => SaleReturnStatus, nullable: true }) status?: SaleReturnStatus,
    @Args('saleId', { type: () => ID, nullable: true }) saleId?: string,
    @Args('replacementSaleId', { type: () => ID, nullable: true }) replacementSaleId?: string,
  ) {
    return this.saleReturnService.findAll(companyId, { status, saleId, replacementSaleId });
  }

  @Query(() => SaleReturnObjectType)
  @RequirePermissions(PermissionCode.SALES_VIEW)
  saleReturn(
    @CurrentCompanyId() companyId: string,
    @Args('id', { type: () => ID }) id: string,
  ) {
    return this.saleReturnService.findOne(companyId, id);
  }

  // Las líneas y los reembolsos van como consultas aparte y no como campos de SaleReturn, para no
  // repetir los guards por cada devolución de un listado.
  @Query(() => [SaleReturnItemObjectType])
  @RequirePermissions(PermissionCode.SALES_VIEW)
  saleReturnItems(
    @CurrentCompanyId() companyId: string,
    @Args('saleReturnId', { type: () => ID }) saleReturnId: string,
  ) {
    return this.saleReturnService.findItems(companyId, saleReturnId);
  }

  @Query(() => [RefundPaymentObjectType])
  @RequirePermissions(PermissionCode.SALES_VIEW)
  refundPayments(
    @CurrentCompanyId() companyId: string,
    @Args('saleReturnId', { type: () => ID }) saleReturnId: string,
  ) {
    return this.saleReturnService.findRefunds(companyId, saleReturnId);
  }

  // Los reembolsos en efectivo de un turno, para su detalle de cierre. Autorizado igual que
  // SaleResolver.cashSessionSales (por el turno, no por sales.view): quien puede ver el turno ve
  // sus devoluciones.
  @Query(() => [SessionRefundObjectType])
  @RequireAnyPermission(
    PermissionCode.CASH_OPEN_CLOSE_SHIFT,
    PermissionCode.CASH_REGISTER_PAYMENT,
    PermissionCode.CASH_VIEW_ALL,
  )
  cashSessionRefunds(
    @CurrentCompanyId() companyId: string,
    @CurrentCompanyAccess() access: CompanyAccess,
    @CurrentUser() currentUser: JwtPayload,
    @Args('cashSessionId', { type: () => ID }) cashSessionId: string,
  ) {
    return this.saleReturnService.findRefundsInSession(
      companyId,
      cashActor(currentUser.sub, access.permissionCodes),
      cashSessionId,
    );
  }

  // El cajero registra la devolución de una venta cobrada; queda pendiente de aprobación.
  @Mutation(() => SaleReturnObjectType)
  @RequirePermissions(PermissionCode.SALES_RETURN)
  requestSaleReturn(
    @CurrentCompanyId() companyId: string,
    @CurrentUser() currentUser: JwtPayload,
    @Args('input') input: RequestSaleReturnInput,
  ) {
    return this.saleReturnService.request(companyId, currentUser.sub, input);
  }

  // Un administrador ajusta lo que pidió el cajero (qué líneas, cuántas unidades, dinero o cambio)
  // mientras la devolución siga pendiente, para aprobar solo lo que procede.
  @Mutation(() => SaleReturnObjectType)
  @RequirePermissions(PermissionCode.SALES_APPROVE_RETURN)
  editSaleReturn(
    @CurrentCompanyId() companyId: string,
    @CurrentUser() currentUser: JwtPayload,
    @Args('id', { type: () => ID }) id: string,
    @Args('input') input: EditSaleReturnInput,
  ) {
    return this.saleReturnService.edit(companyId, currentUser.sub, id, input);
  }

  @Mutation(() => SaleReturnObjectType)
  @RequirePermissions(PermissionCode.SALES_APPROVE_RETURN)
  approveSaleReturn(
    @CurrentCompanyId() companyId: string,
    @CurrentUser() currentUser: JwtPayload,
    @Args('id', { type: () => ID }) id: string,
    @Args('input') input: SaleReturnNotesInput,
  ) {
    return this.saleReturnService.approve(companyId, currentUser.sub, id, input);
  }

  @Mutation(() => SaleReturnObjectType)
  @RequirePermissions(PermissionCode.SALES_APPROVE_RETURN)
  rejectSaleReturn(
    @CurrentCompanyId() companyId: string,
    @CurrentUser() currentUser: JwtPayload,
    @Args('id', { type: () => ID }) id: string,
    @Args('input') input: SaleReturnNotesInput,
  ) {
    return this.saleReturnService.reject(companyId, currentUser.sub, id, input);
  }

  // Quien la registró (con sales.return) o quien aprueba devoluciones: el servicio comprueba cuál.
  @Mutation(() => SaleReturnObjectType)
  @RequireAnyPermission(PermissionCode.SALES_RETURN, PermissionCode.SALES_APPROVE_RETURN)
  cancelSaleReturn(
    @CurrentCompanyId() companyId: string,
    @CurrentCompanyAccess() access: CompanyAccess,
    @CurrentUser() currentUser: JwtPayload,
    @Args('id', { type: () => ID }) id: string,
    @Args('input') input: SaleReturnNotesInput,
  ) {
    const canApprove = access.permissionCodes.includes(PermissionCode.SALES_APPROVE_RETURN);
    return this.saleReturnService.cancel(companyId, currentUser.sub, id, canApprove, input);
  }

  // Entrega el dinero de una devolución aprobada. El cambio no pasa por aquí: se cobra la venta
  // nueva con `completeSale` indicando el `saleReturnId`.
  @Mutation(() => SaleReturnObjectType)
  @RequirePermissions(PermissionCode.SALES_RETURN)
  completeSaleReturnRefund(
    @CurrentCompanyId() companyId: string,
    @CurrentCompanyAccess() access: CompanyAccess,
    @CurrentUser() currentUser: JwtPayload,
    @Args('input') input: CompleteReturnRefundInput,
  ) {
    return this.saleReturnService.completeRefund(
      companyId,
      cashActor(currentUser.sub, access.permissionCodes),
      input,
    );
  }
}
