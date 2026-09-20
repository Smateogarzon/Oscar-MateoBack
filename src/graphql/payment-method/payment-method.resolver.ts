import { UseGuards } from '@nestjs/common';
import { Args, ID, Mutation, Query, Resolver } from '@nestjs/graphql';
import { CurrentCompanyId } from '../../common/decorators/current-company.decorator.js';
import {
  RequireAnyPermission,
  RequirePermissions,
} from '../../common/decorators/permissions.decorator.js';
import { PermissionCode } from '../../common/enums/permission-code.enum.js';
import { RecordStatus } from '../../common/enums/record-status.enum.js';
import { CsrfGuard } from '../../common/guards/csrf.guard.js';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard.js';
import { PermissionsGuard } from '../../common/guards/permissions.guard.js';
import { CreatePaymentMethodInput } from './dto/create-payment-method.input.js';
import { PaymentMethodObjectType } from './dto/payment-method.object-type.js';
import { UpdatePaymentMethodInput } from './dto/update-payment-method.input.js';
import { PaymentMethodService } from './payment-method.service.js';

@Resolver(() => PaymentMethodObjectType)
@UseGuards(JwtAuthGuard, PermissionsGuard, CsrfGuard)
export class PaymentMethodResolver {
  constructor(private readonly paymentMethodService: PaymentMethodService) {}

  // Quien cobra necesita la lista para elegir el medio; quien configura, para administrarla.
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

  @Mutation(() => PaymentMethodObjectType)
  @RequirePermissions(PermissionCode.SETTINGS_MANAGE)
  createPaymentMethod(
    @CurrentCompanyId() companyId: string,
    @Args('input') input: CreatePaymentMethodInput,
  ) {
    return this.paymentMethodService.create(companyId, input);
  }

  @Mutation(() => PaymentMethodObjectType)
  @RequirePermissions(PermissionCode.SETTINGS_MANAGE)
  updatePaymentMethod(
    @CurrentCompanyId() companyId: string,
    @Args('id', { type: () => ID }) id: string,
    @Args('input') input: UpdatePaymentMethodInput,
  ) {
    return this.paymentMethodService.update(companyId, id, input);
  }

  @Mutation(() => PaymentMethodObjectType)
  @RequirePermissions(PermissionCode.SETTINGS_MANAGE)
  deactivatePaymentMethod(
    @CurrentCompanyId() companyId: string,
    @Args('id', { type: () => ID }) id: string,
  ) {
    return this.paymentMethodService.deactivate(companyId, id);
  }

  @Mutation(() => PaymentMethodObjectType)
  @RequirePermissions(PermissionCode.SETTINGS_MANAGE)
  activatePaymentMethod(
    @CurrentCompanyId() companyId: string,
    @Args('id', { type: () => ID }) id: string,
  ) {
    return this.paymentMethodService.activate(companyId, id);
  }
}
