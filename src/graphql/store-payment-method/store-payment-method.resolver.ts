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
import { CreateStorePaymentMethodInput } from './dto/create-store-payment-method.input.js';
import { StorePaymentMethodObjectType } from './dto/store-payment-method.object-type.js';
import { StorePaymentMethodService } from './store-payment-method.service.js';

@Resolver(() => StorePaymentMethodObjectType)
@UseGuards(JwtAuthGuard, PermissionsGuard, CsrfGuard)
export class StorePaymentMethodResolver {
  constructor(private readonly storePaymentMethodService: StorePaymentMethodService) {}

  // Quien cobra necesita saber con qué se puede cobrar en su tienda; quien configura, para
  // administrarlo.
  @Query(() => [StorePaymentMethodObjectType])
  @RequireAnyPermission(PermissionCode.CASH_REGISTER_PAYMENT, PermissionCode.SETTINGS_MANAGE)
  storePaymentMethods(
    @CurrentCompanyId() companyId: string,
    @Args('storeId', { type: () => ID, nullable: true }) storeId?: string,
    @Args('status', { type: () => RecordStatus, nullable: true }) status?: RecordStatus,
  ) {
    return this.storePaymentMethodService.findAll(companyId, storeId, status);
  }

  @Mutation(() => StorePaymentMethodObjectType)
  @RequirePermissions(PermissionCode.SETTINGS_MANAGE)
  createStorePaymentMethod(
    @CurrentCompanyId() companyId: string,
    @Args('input') input: CreateStorePaymentMethodInput,
  ) {
    return this.storePaymentMethodService.create(companyId, input);
  }

  @Mutation(() => StorePaymentMethodObjectType)
  @RequirePermissions(PermissionCode.SETTINGS_MANAGE)
  deactivateStorePaymentMethod(
    @CurrentCompanyId() companyId: string,
    @Args('id', { type: () => ID }) id: string,
  ) {
    return this.storePaymentMethodService.deactivate(companyId, id);
  }

  @Mutation(() => StorePaymentMethodObjectType)
  @RequirePermissions(PermissionCode.SETTINGS_MANAGE)
  activateStorePaymentMethod(
    @CurrentCompanyId() companyId: string,
    @Args('id', { type: () => ID }) id: string,
  ) {
    return this.storePaymentMethodService.activate(companyId, id);
  }
}
