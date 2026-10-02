import { UseGuards } from '@nestjs/common';
import { Args, ID, Mutation, Query, Resolver } from '@nestjs/graphql';
import type { CompanyAccess } from '../../common/access/company-access.js';
import { CurrentCompanyAccess, CurrentCompanyId } from '../../common/decorators/current-company.decorator.js';
import { CurrentUser } from '../../common/decorators/current-user.decorator.js';
import { IdempotencyKeyHeader } from '../../common/decorators/idempotency-key.decorator.js';
import {
  RequireCompanyMembership,
  RequirePermissions,
} from '../../common/decorators/permissions.decorator.js';
import { PermissionCode } from '../../common/enums/permission-code.enum.js';
import { CsrfGuard } from '../../common/guards/csrf.guard.js';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard.js';
import { PermissionsGuard } from '../../common/guards/permissions.guard.js';
import type { JwtPayload } from '../auth/interface/jwt-payload.interface.js';
import { RequestWriteOffInput } from './dto/request-write-off.input.js';
import { WriteOffItemObjectType } from './dto/write-off-item.object-type.js';
import { WriteOffObjectType } from './dto/write-off.object-type.js';
import { WriteOffStatus } from './entities/write-off-status.enum.js';
import { WriteOffService } from './write-off.service.js';

@Resolver(() => WriteOffObjectType)
@UseGuards(JwtAuthGuard, PermissionsGuard, CsrfGuard)
export class WriteOffResolver {
  constructor(private readonly writeOffService: WriteOffService) {}

  @Query(() => [WriteOffObjectType])
  @RequireCompanyMembership()
  writeOffs(
    @CurrentCompanyId() companyId: string,
    @Args('status', { type: () => WriteOffStatus, nullable: true }) status?: WriteOffStatus,
    @Args('locationId', { type: () => ID, nullable: true }) locationId?: string,
  ) {
    return this.writeOffService.findAll(companyId, { status, locationId });
  }

  @Query(() => WriteOffObjectType)
  @RequireCompanyMembership()
  writeOff(@CurrentCompanyId() companyId: string, @Args('id', { type: () => ID }) id: string) {
    return this.writeOffService.findOne(companyId, id);
  }

  @Query(() => [WriteOffItemObjectType])
  @RequireCompanyMembership()
  writeOffItems(@CurrentCompanyId() companyId: string, @Args('writeOffId', { type: () => ID }) writeOffId: string) {
    return this.writeOffService.findItems(companyId, writeOffId);
  }

  @Mutation(() => WriteOffObjectType)
  @RequirePermissions(PermissionCode.INVENTORY_REQUEST_ADJUSTMENT)
  requestWriteOff(
    @CurrentCompanyId() companyId: string,
    @CurrentUser() currentUser: JwtPayload,
    @Args('input') input: RequestWriteOffInput,
    @IdempotencyKeyHeader() idempotencyKey?: string,
  ) {
    return this.writeOffService.request(companyId, currentUser.sub, input, idempotencyKey);
  }

  @Mutation(() => WriteOffObjectType)
  @RequirePermissions(PermissionCode.INVENTORY_APPROVE_WRITEOFF)
  approveWriteOff(
    @CurrentCompanyId() companyId: string,
    @CurrentUser() currentUser: JwtPayload,
    @Args('id', { type: () => ID }) id: string,
  ) {
    return this.writeOffService.approve(companyId, currentUser.sub, id);
  }

  @Mutation(() => WriteOffObjectType)
  @RequirePermissions(PermissionCode.INVENTORY_APPROVE_WRITEOFF)
  rejectWriteOff(
    @CurrentCompanyId() companyId: string,
    @CurrentUser() currentUser: JwtPayload,
    @Args('id', { type: () => ID }) id: string,
  ) {
    return this.writeOffService.reject(companyId, currentUser.sub, id);
  }

  // Quien la pidió también puede cancelarla aunque no tenga el permiso de aprobar bajas (ver
  // WriteOffService.cancel); por eso esto solo exige pertenecer a la empresa, y el servicio
  // decide con canResolve si además puede cancelar la de alguien más.
  @Mutation(() => WriteOffObjectType)
  @RequireCompanyMembership()
  cancelWriteOff(
    @CurrentCompanyId() companyId: string,
    @CurrentUser() currentUser: JwtPayload,
    @CurrentCompanyAccess() access: CompanyAccess,
    @Args('id', { type: () => ID }) id: string,
  ) {
    const canResolve = access.permissionCodes.includes(PermissionCode.INVENTORY_APPROVE_WRITEOFF);
    return this.writeOffService.cancel(companyId, { userId: currentUser.sub, canResolve }, id);
  }
}
