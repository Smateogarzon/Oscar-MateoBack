import { UseGuards } from '@nestjs/common';
import { Args, ID, Mutation, Query, Resolver } from '@nestjs/graphql';
import type { CompanyAccess } from '../../common/access/company-access.js';
import {
  CurrentCompanyAccess,
  CurrentCompanyId,
} from '../../common/decorators/current-company.decorator.js';
import { CurrentUser } from '../../common/decorators/current-user.decorator.js';
import { IdempotencyKeyHeader } from '../../common/decorators/idempotency-key.decorator.js';
import { RequirePermissions } from '../../common/decorators/permissions.decorator.js';
import { PermissionCode } from '../../common/enums/permission-code.enum.js';
import { CsrfGuard } from '../../common/guards/csrf.guard.js';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard.js';
import { PermissionsGuard } from '../../common/guards/permissions.guard.js';
import type { JwtPayload } from '../auth/interface/jwt-payload.interface.js';
import { cashActor } from '../cash-session/cash-actor.js';
import { SaleObjectType } from '../sale/dto/sale.object-type.js';
import { saleActor } from '../sale/sale-actor.js';
import { CompleteSaleInput } from './dto/complete-sale.input.js';
import { SalePaymentObjectType } from './dto/sale-payment.object-type.js';
import { SalePaymentService } from './sale-payment.service.js';

@Resolver(() => SalePaymentObjectType)
@UseGuards(JwtAuthGuard, PermissionsGuard, CsrfGuard)
export class SalePaymentResolver {
  constructor(private readonly salePaymentService: SalePaymentService) {}

  // Los pagos de una venta. Va como consulta aparte y no como campo de Sale para no repetir los
  // guards por cada venta de un listado. Solo los de una venta que quien pregunta puede ver.
  @Query(() => [SalePaymentObjectType])
  @RequirePermissions(PermissionCode.SALES_VIEW)
  salePayments(
    @CurrentCompanyId() companyId: string,
    @CurrentCompanyAccess() access: CompanyAccess,
    @CurrentUser() currentUser: JwtPayload,
    @Args('saleId', { type: () => ID }) saleId: string,
  ) {
    return this.salePaymentService.findAll(
      companyId,
      saleActor(currentUser.sub, access.permissionCodes),
      saleId,
    );
  }

  // Cobrar la venta: guarda sus pagos y la deja completada. Solo el cajero asignado al turno de la venta
  // puede cobrarla (CashSessionService.lockOpen). Repetir la petición con la misma clave devuelve la
  // venta ya cobrada.
  @Mutation(() => SaleObjectType)
  @RequirePermissions(PermissionCode.CASH_REGISTER_PAYMENT)
  completeSale(
    @CurrentCompanyId() companyId: string,
    @CurrentCompanyAccess() access: CompanyAccess,
    @CurrentUser() currentUser: JwtPayload,
    @Args('input') input: CompleteSaleInput,
    @IdempotencyKeyHeader() idempotencyKey?: string,
  ) {
    return this.salePaymentService.complete(
      companyId,
      cashActor(currentUser.sub, access.permissionCodes),
      input,
      idempotencyKey,
    );
  }
}
