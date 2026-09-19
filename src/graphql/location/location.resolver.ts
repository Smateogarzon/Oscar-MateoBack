import { UseGuards } from '@nestjs/common';
import { Args, ID, Mutation, Query, Resolver } from '@nestjs/graphql';
import { assertActiveCompany } from '../../common/access/assert-active-company.js';
import { CurrentCompanyId } from '../../common/decorators/current-company.decorator.js';
import {
  RequireCompanyMembership,
  RequirePermissions,
} from '../../common/decorators/permissions.decorator.js';
import { PermissionCode } from '../../common/enums/permission-code.enum.js';
import { RecordStatus } from '../../common/enums/record-status.enum.js';
import { CsrfGuard } from '../../common/guards/csrf.guard.js';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard.js';
import { PermissionsGuard } from '../../common/guards/permissions.guard.js';
import { CreateLocationInput } from './dto/create-location.input.js';
import { LocationObjectType } from './dto/location.object-type.js';
import { UpdateLocationInput } from './dto/update-location.input.js';
import { LocationService } from './location.service.js';

@Resolver(() => LocationObjectType)
@UseGuards(JwtAuthGuard, PermissionsGuard, CsrfGuard)
export class LocationResolver {
  constructor(private readonly locationService: LocationService) {}

  // Cualquier miembro ve las sedes de su empresa (los demás módulos las necesitan);
  // `companyId` se acepta por compatibilidad, pero solo puede ser la empresa activa.
  @Query(() => [LocationObjectType])
  @RequireCompanyMembership()
  locations(
    @CurrentCompanyId() activeCompanyId: string,
    @Args('companyId', { type: () => ID, nullable: true }) companyId?: string,
    @Args('status', { type: () => RecordStatus, nullable: true })
    status?: RecordStatus,
  ) {
    assertActiveCompany(activeCompanyId, companyId);
    return this.locationService.findAll(activeCompanyId, status);
  }

  @Query(() => LocationObjectType)
  @RequireCompanyMembership()
  location(
    @CurrentCompanyId() companyId: string,
    @Args('id', { type: () => ID }) id: string,
  ) {
    return this.locationService.findOne(companyId, id);
  }

  @Mutation(() => LocationObjectType)
  @RequirePermissions(PermissionCode.SETTINGS_MANAGE)
  createLocation(
    @CurrentCompanyId() companyId: string,
    @Args('input') input: CreateLocationInput,
  ) {
    return this.locationService.create(companyId, input);
  }

  @Mutation(() => LocationObjectType)
  @RequirePermissions(PermissionCode.SETTINGS_MANAGE)
  updateLocation(
    @CurrentCompanyId() companyId: string,
    @Args('id', { type: () => ID }) id: string,
    @Args('input') input: UpdateLocationInput,
  ) {
    return this.locationService.update(companyId, id, input);
  }

  @Mutation(() => LocationObjectType)
  @RequirePermissions(PermissionCode.SETTINGS_MANAGE)
  deactivateLocation(
    @CurrentCompanyId() companyId: string,
    @Args('id', { type: () => ID }) id: string,
  ) {
    return this.locationService.deactivate(companyId, id);
  }
}
