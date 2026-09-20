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
import { CashMovementService } from './cash-movement.service.js';
import { CashMovementObjectType } from './dto/cash-movement.object-type.js';
import { RegisterCashMovementInput } from './dto/register-cash-movement.input.js';

@Resolver(() => CashMovementObjectType)
@UseGuards(JwtAuthGuard, PermissionsGuard, CsrfGuard)
export class CashMovementResolver {
  constructor(private readonly cashMovementService: CashMovementService) {}

  // Cada cajero ve los movimientos de sus turnos; quien abre y cierra turnos, o tiene
  // cash.view_all, ve los de todos.
  @Query(() => [CashMovementObjectType])
  @RequireAnyPermission(
    PermissionCode.CASH_OPEN_CLOSE_SHIFT,
    PermissionCode.CASH_REGISTER_PAYMENT,
    PermissionCode.CASH_VIEW_ALL,
  )
  cashMovements(
    @CurrentCompanyId() companyId: string,
    @CurrentCompanyAccess() access: CompanyAccess,
    @CurrentUser() currentUser: JwtPayload,
    @Args('cashSessionId', { type: () => ID }) cashSessionId: string,
  ) {
    return this.cashMovementService.findAll(
      companyId,
      cashActor(currentUser.sub, access.permissionCodes),
      cashSessionId,
    );
  }

  // Solo el cajero asignado al turno, y con el código del día que le da el administrador: el
  // servicio comprueba las dos cosas.
  @Mutation(() => CashMovementObjectType)
  @RequirePermissions(PermissionCode.CASH_REGISTER_PAYMENT)
  registerCashMovement(
    @CurrentCompanyId() companyId: string,
    @CurrentCompanyAccess() access: CompanyAccess,
    @CurrentUser() currentUser: JwtPayload,
    @Args('input') input: RegisterCashMovementInput,
  ) {
    return this.cashMovementService.register(
      companyId,
      cashActor(currentUser.sub, access.permissionCodes),
      input,
    );
  }
}
