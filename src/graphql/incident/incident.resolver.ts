import { UseGuards } from '@nestjs/common';
import { Args, ID, Mutation, Query, Resolver } from '@nestjs/graphql';
import { CurrentCompanyId } from '../../common/decorators/current-company.decorator.js';
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
import { CreateIncidentInput } from './dto/create-incident.input.js';
import { IncidentObjectType } from './dto/incident.object-type.js';
import { IncidentStatus } from './entities/incident-status.enum.js';
import { IncidentType } from './entities/incident-type.enum.js';
import { IncidentService } from './incident.service.js';

@Resolver(() => IncidentObjectType)
@UseGuards(JwtAuthGuard, PermissionsGuard, CsrfGuard)
export class IncidentResolver {
  constructor(private readonly incidentService: IncidentService) {}

  @Query(() => [IncidentObjectType])
  @RequireCompanyMembership()
  incidents(
    @CurrentCompanyId() companyId: string,
    @Args('type', { type: () => IncidentType, nullable: true }) type?: IncidentType,
    @Args('status', { type: () => IncidentStatus, nullable: true }) status?: IncidentStatus,
    @Args('locationId', { type: () => ID, nullable: true }) locationId?: string,
  ) {
    return this.incidentService.findAll(companyId, { type, status, locationId });
  }

  @Query(() => IncidentObjectType)
  @RequireCompanyMembership()
  incident(@CurrentCompanyId() companyId: string, @Args('id', { type: () => ID }) id: string) {
    return this.incidentService.findOne(companyId, id);
  }

  // Sin permiso especial: cualquiera que vea el problema lo reporta.
  @Mutation(() => IncidentObjectType)
  @RequireCompanyMembership()
  reportIncident(
    @CurrentCompanyId() companyId: string,
    @CurrentUser() currentUser: JwtPayload,
    @Args('input') input: CreateIncidentInput,
    @IdempotencyKeyHeader() idempotencyKey?: string,
  ) {
    return this.incidentService.report(companyId, currentUser.sub, input, idempotencyKey);
  }

  @Mutation(() => IncidentObjectType)
  @RequirePermissions(PermissionCode.INVENTORY_MANAGE_PRODUCTS)
  startIncidentReview(@CurrentCompanyId() companyId: string, @Args('id', { type: () => ID }) id: string) {
    return this.incidentService.startReview(companyId, id);
  }

  @Mutation(() => IncidentObjectType)
  @RequirePermissions(PermissionCode.INVENTORY_MANAGE_PRODUCTS)
  resolveIncident(
    @CurrentCompanyId() companyId: string,
    @CurrentUser() currentUser: JwtPayload,
    @Args('id', { type: () => ID }) id: string,
  ) {
    return this.incidentService.resolve(companyId, currentUser.sub, id);
  }

  @Mutation(() => IncidentObjectType)
  @RequirePermissions(PermissionCode.INVENTORY_MANAGE_PRODUCTS)
  cancelIncident(
    @CurrentCompanyId() companyId: string,
    @CurrentUser() currentUser: JwtPayload,
    @Args('id', { type: () => ID }) id: string,
  ) {
    return this.incidentService.cancel(companyId, currentUser.sub, id);
  }
}
