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
import { cashActor } from '../cash-session/cash-actor.js';
import { saleActor } from '../sale/sale-actor.js';
import { CompleteReturnRefundInput } from './dto/complete-return-refund.input.js';
import { EditSaleReturnInput } from './dto/edit-sale-return.input.js';
import { RefundPaymentObjectType } from './dto/refund-payment.object-type.js';
import { RequestSaleReturnInput } from './dto/request-sale-return.input.js';
import { SaleReturnItemObjectType } from './dto/sale-return-item.object-type.js';
import { SaleReturnNotesInput } from './dto/sale-return-notes.input.js';
import { SaleReturnObjectType } from './dto/sale-return.object-type.js';
import { SessionRefundObjectType } from './dto/session-refund.object-type.js';
import { SaleReturnStatus } from './entities/sale-return-status.enum.js';
import type { SaleReturn } from './entities/sale-return.entity.js';
import { SaleReturnService } from './sale-return.service.js';

@Resolver(() => SaleReturnObjectType)
@UseGuards(JwtAuthGuard, PermissionsGuard, CsrfGuard)
export class SaleReturnResolver {
  constructor(private readonly saleReturnService: SaleReturnService) {}

  // Se puede consultar desde la venta original (`saleId`) o desde la venta nueva de un cambio
  // (`replacementSaleId`). Cada quien ve las devoluciones de SUS ventas y las que registró; quien ve todo
  // o aprueba devoluciones ve todas. Va acotada: `limit` (500 por defecto, 1000 máximo) con `offset`.
  @Query(() => [SaleReturnObjectType])
  @RequirePermissions(PermissionCode.SALES_VIEW)
  saleReturns(
    @CurrentCompanyId() companyId: string,
    @CurrentCompanyAccess() access: CompanyAccess,
    @CurrentUser() currentUser: JwtPayload,
    @Args('status', { type: () => SaleReturnStatus, nullable: true }) status?: SaleReturnStatus,
    @Args('saleId', { type: () => ID, nullable: true }) saleId?: string,
    @Args('replacementSaleId', { type: () => ID, nullable: true }) replacementSaleId?: string,
    @Args('limit', { type: () => Int, nullable: true }) limit?: number,
    @Args('offset', { type: () => Int, nullable: true }) offset?: number,
  ) {
    return this.saleReturnService.findAll(
      companyId,
      saleActor(currentUser.sub, access.permissionCodes),
      { status, saleId, replacementSaleId, limit, offset },
    );
  }

  @Query(() => SaleReturnObjectType)
  @RequirePermissions(PermissionCode.SALES_VIEW)
  saleReturn(
    @CurrentCompanyId() companyId: string,
    @CurrentCompanyAccess() access: CompanyAccess,
    @CurrentUser() currentUser: JwtPayload,
    @Args('id', { type: () => ID }) id: string,
  ) {
    return this.saleReturnService.findVisible(
      companyId,
      saleActor(currentUser.sub, access.permissionCodes),
      id,
    );
  }

  // El número de la venta original: ya viene cargado en las listas; en una devolución suelta se busca.
  @ResolveField(() => String, { nullable: true })
  saleNumber(@Parent() saleReturn: SaleReturnObjectType) {
    return this.saleReturnService.saleNumberOf(saleReturn as unknown as SaleReturn);
  }

  // Las líneas y los reembolsos van como consultas aparte y no como campos de SaleReturn, para no
  // repetir los guards por cada devolución de un listado.
  @Query(() => [SaleReturnItemObjectType])
  @RequirePermissions(PermissionCode.SALES_VIEW)
  saleReturnItems(
    @CurrentCompanyId() companyId: string,
    @CurrentCompanyAccess() access: CompanyAccess,
    @CurrentUser() currentUser: JwtPayload,
    @Args('saleReturnId', { type: () => ID }) saleReturnId: string,
  ) {
    return this.saleReturnService.findItems(
      companyId,
      saleActor(currentUser.sub, access.permissionCodes),
      saleReturnId,
    );
  }

  @Query(() => [RefundPaymentObjectType])
  @RequirePermissions(PermissionCode.SALES_VIEW)
  refundPayments(
    @CurrentCompanyId() companyId: string,
    @CurrentCompanyAccess() access: CompanyAccess,
    @CurrentUser() currentUser: JwtPayload,
    @Args('saleReturnId', { type: () => ID }) saleReturnId: string,
  ) {
    return this.saleReturnService.findRefunds(
      companyId,
      saleActor(currentUser.sub, access.permissionCodes),
      saleReturnId,
    );
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

  // El cajero registra la devolución de una venta cobrada; queda pendiente de aprobación. Solo de una
  // venta que puede ver y en una tienda a la que tiene acceso.
  @Mutation(() => SaleReturnObjectType)
  @RequirePermissions(PermissionCode.SALES_RETURN)
  requestSaleReturn(
    @CurrentCompanyId() companyId: string,
    @CurrentCompanyAccess() access: CompanyAccess,
    @CurrentUser() currentUser: JwtPayload,
    @Args('input') input: RequestSaleReturnInput,
    @IdempotencyKeyHeader() idempotencyKey?: string,
  ) {
    return this.saleReturnService.request(
      companyId,
      saleActor(currentUser.sub, access.permissionCodes),
      input,
      idempotencyKey,
    );
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
    @IdempotencyKeyHeader() idempotencyKey?: string,
  ) {
    return this.saleReturnService.approve(companyId, currentUser.sub, id, input, idempotencyKey);
  }

  @Mutation(() => SaleReturnObjectType)
  @RequirePermissions(PermissionCode.SALES_APPROVE_RETURN)
  rejectSaleReturn(
    @CurrentCompanyId() companyId: string,
    @CurrentUser() currentUser: JwtPayload,
    @Args('id', { type: () => ID }) id: string,
    @Args('input') input: SaleReturnNotesInput,
    @IdempotencyKeyHeader() idempotencyKey?: string,
  ) {
    return this.saleReturnService.reject(companyId, currentUser.sub, id, input, idempotencyKey);
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
  // nueva con `completeSale` indicando el `saleReturnId`. Quien lo entrega tiene acceso a la tienda de
  // la venta original y, si es en efectivo, sale de un turno de esa tienda.
  @Mutation(() => SaleReturnObjectType)
  @RequirePermissions(PermissionCode.SALES_RETURN)
  completeSaleReturnRefund(
    @CurrentCompanyId() companyId: string,
    @CurrentCompanyAccess() access: CompanyAccess,
    @CurrentUser() currentUser: JwtPayload,
    @Args('input') input: CompleteReturnRefundInput,
    @IdempotencyKeyHeader() idempotencyKey?: string,
  ) {
    return this.saleReturnService.completeRefund(
      companyId,
      cashActor(currentUser.sub, access.permissionCodes),
      input,
      idempotencyKey,
    );
  }
}
