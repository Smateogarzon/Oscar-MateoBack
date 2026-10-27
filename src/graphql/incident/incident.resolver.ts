import { UseGuards } from '@nestjs/common';
import { Args, ID, Mutation, Query, Resolver } from '@nestjs/graphql';
import type { CompanyAccess } from '../../common/access/company-access.js';
import { CurrentCompanyAccess, CurrentCompanyId } from '../../common/decorators/current-company.decorator.js';
import { CurrentUser } from '../../common/decorators/current-user.decorator.js';
import { IdempotencyKeyHeader } from '../../common/decorators/idempotency-key.decorator.js';
import {
  RequireAnyPermission,
  RequireCompanyMembership,
  RequirePermissions,
} from '../../common/decorators/permissions.decorator.js';
import { PermissionCode } from '../../common/enums/permission-code.enum.js';
import { RoleCode } from '../../common/enums/role-code.enum.js';
import { CsrfGuard } from '../../common/guards/csrf.guard.js';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard.js';
import { PermissionsGuard } from '../../common/guards/permissions.guard.js';
import type { JwtPayload } from '../auth/interface/jwt-payload.interface.js';
import { CreateIncidentInput } from './dto/create-incident.input.js';
import { IncidentObjectType } from './dto/incident.object-type.js';
import { IncidentStatus } from './entities/incident-status.enum.js';
import { IncidentType } from './entities/incident-type.enum.js';
import { IncidentService } from './incident.service.js';

// Quién lee las novedades: la operación que las atiende (bodega, inventario, compras). Antes bastaba
// ser miembro y una caja o un vendedor leían todas las de la empresa. El proveedor entra por compras
// y el servicio le limita la lectura a las de sus propias órdenes.
const CAN_READ_INCIDENTS = [
  PermissionCode.INVENTORY_MANAGE_PRODUCTS,
  PermissionCode.WAREHOUSE_FULFILL_ORDERS,
  PermissionCode.WAREHOUSE_RECEIVE_RETURNS,
  PermissionCode.SUPPLIERS_MANAGE_PURCHASE_ORDERS,
  PermissionCode.SUPPLIERS_REGISTER_DELIVERY,
];

// El proveedor (rol SUPPLIER) solo ve las novedades de sus órdenes; el resto de la empresa, todas.
const supplierScopeOf = (access: CompanyAccess, userId: string): string | undefined =>
  access.roleCodes.includes(RoleCode.SUPPLIER) ? userId : undefined;

@Resolver(() => IncidentObjectType)
@UseGuards(JwtAuthGuard, PermissionsGuard, CsrfGuard)
export class IncidentResolver {
  constructor(private readonly incidentService: IncidentService) {}

  @Query(() => [IncidentObjectType])
  @RequireAnyPermission(...CAN_READ_INCIDENTS)
  incidents(
    @CurrentCompanyId() companyId: string,
    @CurrentUser() currentUser: JwtPayload,
    @CurrentCompanyAccess() access: CompanyAccess,
    @Args('type', { type: () => IncidentType, nullable: true }) type?: IncidentType,
    @Args('status', { type: () => IncidentStatus, nullable: true }) status?: IncidentStatus,
    @Args('locationId', { type: () => ID, nullable: true }) locationId?: string,
  ) {
    return this.incidentService.findAll(
      companyId,
      { type, status, locationId },
      supplierScopeOf(access, currentUser.sub),
    );
  }

  @Query(() => IncidentObjectType)
  @RequireAnyPermission(...CAN_READ_INCIDENTS)
  incident(
    @CurrentCompanyId() companyId: string,
    @CurrentUser() currentUser: JwtPayload,
    @CurrentCompanyAccess() access: CompanyAccess,
    @Args('id', { type: () => ID }) id: string,
  ) {
    return this.incidentService.findOne(companyId, id, supplierScopeOf(access, currentUser.sub));
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
