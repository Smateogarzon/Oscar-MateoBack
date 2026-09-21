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
import { CashRegisterService } from './cash-register.service.js';
import { CashRegisterObjectType } from './dto/cash-register.object-type.js';
import { CreateCashRegisterInput } from './dto/create-cash-register.input.js';
import { UpdateCashRegisterInput } from './dto/update-cash-register.input.js';

@Resolver(() => CashRegisterObjectType)
@UseGuards(JwtAuthGuard, PermissionsGuard, CsrfGuard)
export class CashRegisterResolver {
  constructor(private readonly cashRegisterService: CashRegisterService) {}

  // Quien abre turnos necesita la lista para elegir su caja; quien configura, para administrarla; y
  // quien cobra, para saber en qué caja y en qué tienda está trabajando (sin eso no puede ni
  // nombrar su caja ni registrar una venta). Solo se leen las de la empresa activa.
  @Query(() => [CashRegisterObjectType])
  @RequireAnyPermission(
    PermissionCode.CASH_OPEN_CLOSE_SHIFT,
    PermissionCode.SETTINGS_MANAGE,
    PermissionCode.CASH_REGISTER_PAYMENT,
  )
  cashRegisters(
    @CurrentCompanyId() companyId: string,
    @Args('storeId', { type: () => ID, nullable: true }) storeId?: string,
    @Args('status', { type: () => RecordStatus, nullable: true }) status?: RecordStatus,
  ) {
    return this.cashRegisterService.findAll(companyId, { storeId, status });
  }

  @Query(() => CashRegisterObjectType)
  @RequireAnyPermission(
    PermissionCode.CASH_OPEN_CLOSE_SHIFT,
    PermissionCode.SETTINGS_MANAGE,
    PermissionCode.CASH_REGISTER_PAYMENT,
  )
  cashRegister(
    @CurrentCompanyId() companyId: string,
    @Args('id', { type: () => ID }) id: string,
  ) {
    return this.cashRegisterService.findOne(companyId, id);
  }

  @Mutation(() => CashRegisterObjectType)
  @RequirePermissions(PermissionCode.SETTINGS_MANAGE)
  createCashRegister(
    @CurrentCompanyId() companyId: string,
    @Args('input') input: CreateCashRegisterInput,
  ) {
    return this.cashRegisterService.create(companyId, input);
  }

  @Mutation(() => CashRegisterObjectType)
  @RequirePermissions(PermissionCode.SETTINGS_MANAGE)
  updateCashRegister(
    @CurrentCompanyId() companyId: string,
    @Args('id', { type: () => ID }) id: string,
    @Args('input') input: UpdateCashRegisterInput,
  ) {
    return this.cashRegisterService.update(companyId, id, input);
  }

  @Mutation(() => CashRegisterObjectType)
  @RequirePermissions(PermissionCode.SETTINGS_MANAGE)
  deactivateCashRegister(
    @CurrentCompanyId() companyId: string,
    @Args('id', { type: () => ID }) id: string,
  ) {
    return this.cashRegisterService.deactivate(companyId, id);
  }

  @Mutation(() => CashRegisterObjectType)
  @RequirePermissions(PermissionCode.SETTINGS_MANAGE)
  activateCashRegister(
    @CurrentCompanyId() companyId: string,
    @Args('id', { type: () => ID }) id: string,
  ) {
    return this.cashRegisterService.activate(companyId, id);
  }
}
