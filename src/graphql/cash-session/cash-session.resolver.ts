import { UseGuards } from '@nestjs/common';
import { Args, ID, Int, Mutation, Query, Resolver } from '@nestjs/graphql';
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
import { UserObjectType } from '../user/dto/user.object-type.js';
import { cashActor } from './cash-actor.js';
import { CashSessionService } from './cash-session.service.js';
import { CashSessionSummaryObjectType } from './dto/cash-session-summary.object-type.js';
import { CashSessionObjectType } from './dto/cash-session.object-type.js';
import { CloseCashSessionInput } from './dto/close-cash-session.input.js';
import { OpenCashSessionInput } from './dto/open-cash-session.input.js';
import { OpenedCashSessionObjectType } from './dto/opened-cash-session.object-type.js';
import { CashSessionStatus } from './entities/cash-session-status.enum.js';

@Resolver(() => CashSessionObjectType)
@UseGuards(JwtAuthGuard, PermissionsGuard, CsrfGuard)
export class CashSessionResolver {
  constructor(private readonly cashSessionService: CashSessionService) {}

  // El historial: cada cajero ve los turnos que se le asignaron; quien abre y cierra turnos, o tiene
  // cash.view_all, ve los de todos.
  @Query(() => [CashSessionObjectType])
  @RequireAnyPermission(
    PermissionCode.CASH_OPEN_CLOSE_SHIFT,
    PermissionCode.CASH_REGISTER_PAYMENT,
    PermissionCode.CASH_VIEW_ALL,
  )
  cashSessions(
    @CurrentCompanyId() companyId: string,
    @CurrentCompanyAccess() access: CompanyAccess,
    @CurrentUser() currentUser: JwtPayload,
    @Args('status', { type: () => CashSessionStatus, nullable: true }) status?: CashSessionStatus,
    @Args('cashRegisterId', { type: () => ID, nullable: true }) cashRegisterId?: string,
    @Args('limit', { type: () => Int, nullable: true }) limit?: number,
    @Args('offset', { type: () => Int, nullable: true }) offset?: number,
  ) {
    return this.cashSessionService.findAll(
      companyId,
      cashActor(currentUser.sub, access.permissionCodes),
      { status, cashRegisterId, limit, offset },
    );
  }

  @Query(() => CashSessionObjectType)
  @RequireAnyPermission(
    PermissionCode.CASH_OPEN_CLOSE_SHIFT,
    PermissionCode.CASH_REGISTER_PAYMENT,
    PermissionCode.CASH_VIEW_ALL,
  )
  cashSession(
    @CurrentCompanyId() companyId: string,
    @CurrentCompanyAccess() access: CompanyAccess,
    @CurrentUser() currentUser: JwtPayload,
    @Args('id', { type: () => ID }) id: string,
  ) {
    return this.cashSessionService.findOne(
      companyId,
      cashActor(currentUser.sub, access.permissionCodes),
      id,
    );
  }

  // El turno abierto que se le asignó a quien pregunta, para que el front sepa en cuál cobrar
  // (null si no tiene).
  @Query(() => CashSessionObjectType, { nullable: true })
  @RequireAnyPermission(PermissionCode.CASH_REGISTER_PAYMENT, PermissionCode.CASH_OPEN_CLOSE_SHIFT)
  myOpenCashSession(
    @CurrentCompanyId() companyId: string,
    @CurrentUser() currentUser: JwtPayload,
  ) {
    return this.cashSessionService.findMyOpen(companyId, currentUser.sub);
  }

  // A quién se le puede asignar el turno de una caja de esta tienda: quienes tienen acceso a ella y un
  // rol con permiso para cobrar. Es lo que necesita quien abre turnos para elegir cajero, y no exige
  // poder administrar usuarios.
  @Query(() => [UserObjectType])
  @RequirePermissions(PermissionCode.CASH_OPEN_CLOSE_SHIFT)
  cashierCandidates(
    @CurrentCompanyId() companyId: string,
    @Args('storeId', { type: () => ID }) storeId: string,
  ) {
    return this.cashSessionService.findCashierCandidates(companyId, storeId);
  }

  // Cuánto debería haber en la caja hasta ahora, antes de contarla para cerrar.
  @Query(() => CashSessionSummaryObjectType)
  @RequireAnyPermission(
    PermissionCode.CASH_OPEN_CLOSE_SHIFT,
    PermissionCode.CASH_REGISTER_PAYMENT,
    PermissionCode.CASH_VIEW_ALL,
  )
  cashSessionSummary(
    @CurrentCompanyId() companyId: string,
    @CurrentCompanyAccess() access: CompanyAccess,
    @CurrentUser() currentUser: JwtPayload,
    @Args('cashSessionId', { type: () => ID }) cashSessionId: string,
  ) {
    return this.cashSessionService.summary(
      companyId,
      cashActor(currentUser.sub, access.permissionCodes),
      cashSessionId,
    );
  }

  // El código del día de un turno abierto, solo para el administrador: el cajero se lo pide.
  @Query(() => String)
  @RequirePermissions(PermissionCode.CASH_OPEN_CLOSE_SHIFT)
  cashSessionMovementCode(
    @CurrentCompanyId() companyId: string,
    @CurrentCompanyAccess() access: CompanyAccess,
    @CurrentUser() currentUser: JwtPayload,
    @Args('cashSessionId', { type: () => ID }) cashSessionId: string,
  ) {
    return this.cashSessionService.getMovementCode(
      companyId,
      cashActor(currentUser.sub, access.permissionCodes),
      cashSessionId,
    );
  }

  // El administrador abre el turno de una caja para UN cajero y recibe el código del día, que solo
  // él ve. Cada apertura crea un código nuevo.
  @Mutation(() => OpenedCashSessionObjectType)
  @RequirePermissions(PermissionCode.CASH_OPEN_CLOSE_SHIFT)
  async openCashSession(
    @CurrentCompanyId() companyId: string,
    @CurrentUser() currentUser: JwtPayload,
    @Args('input') input: OpenCashSessionInput,
    @IdempotencyKeyHeader() idempotencyKey?: string,
  ) {
    const { session, code } = await this.cashSessionService.open(
      companyId,
      currentUser.sub,
      input,
      idempotencyKey,
    );
    return { session, code };
  }

  // Lo cierra el administrador, con el efectivo contado.
  @Mutation(() => CashSessionObjectType)
  @RequirePermissions(PermissionCode.CASH_OPEN_CLOSE_SHIFT)
  closeCashSession(
    @CurrentCompanyId() companyId: string,
    @CurrentCompanyAccess() access: CompanyAccess,
    @CurrentUser() currentUser: JwtPayload,
    @Args('input') input: CloseCashSessionInput,
    @IdempotencyKeyHeader() idempotencyKey?: string,
  ) {
    return this.cashSessionService.close(
      companyId,
      cashActor(currentUser.sub, access.permissionCodes),
      input,
      idempotencyKey,
    );
  }

  // Cambia el código de un turno abierto: el anterior deja de servir y los movimientos se
  // desbloquean si estaban bloqueados por códigos equivocados.
  @Mutation(() => String)
  @RequirePermissions(PermissionCode.CASH_OPEN_CLOSE_SHIFT)
  regenerateCashMovementCode(
    @CurrentCompanyId() companyId: string,
    @CurrentCompanyAccess() access: CompanyAccess,
    @CurrentUser() currentUser: JwtPayload,
    @Args('cashSessionId', { type: () => ID }) cashSessionId: string,
  ) {
    return this.cashSessionService.regenerateMovementCode(
      companyId,
      cashActor(currentUser.sub, access.permissionCodes),
      cashSessionId,
    );
  }
}
