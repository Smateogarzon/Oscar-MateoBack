import { UseGuards } from '@nestjs/common';
import { Args, ID, Query, Resolver } from '@nestjs/graphql';
import { CurrentCompanyId } from '../../common/decorators/current-company.decorator.js';
import { RequireAnyPermission } from '../../common/decorators/permissions.decorator.js';
import { PermissionCode } from '../../common/enums/permission-code.enum.js';
import { RecordStatus } from '../../common/enums/record-status.enum.js';
import { CsrfGuard } from '../../common/guards/csrf.guard.js';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard.js';
import { PermissionsGuard } from '../../common/guards/permissions.guard.js';
import { PaymentMethodObjectType } from './dto/payment-method.object-type.js';
import { PaymentMethodService } from './payment-method.service.js';

// Los medios de pago no se administran: nacen con la empresa (ver default-payment-methods.ts). Lo
// que se configura es cuáles acepta cada tienda (StorePaymentMethodResolver).
@Resolver(() => PaymentMethodObjectType)
@UseGuards(JwtAuthGuard, PermissionsGuard, CsrfGuard)
export class PaymentMethodResolver {
  constructor(private readonly paymentMethodService: PaymentMethodService) {}

  // Quien cobra necesita la lista para elegir el medio; quien configura, para asignarlos por tienda.
  @Query(() => [PaymentMethodObjectType])
  @RequireAnyPermission(PermissionCode.CASH_REGISTER_PAYMENT, PermissionCode.SETTINGS_MANAGE)
  paymentMethods(
    @CurrentCompanyId() companyId: string,
    @Args('status', { type: () => RecordStatus, nullable: true }) status?: RecordStatus,
  ) {
    return this.paymentMethodService.findAll(companyId, status);
  }

  @Query(() => PaymentMethodObjectType)
  @RequireAnyPermission(PermissionCode.CASH_REGISTER_PAYMENT, PermissionCode.SETTINGS_MANAGE)
  paymentMethod(
    @CurrentCompanyId() companyId: string,
    @Args('id', { type: () => ID }) id: string,
  ) {
    return this.paymentMethodService.findOne(companyId, id);
  }
}
