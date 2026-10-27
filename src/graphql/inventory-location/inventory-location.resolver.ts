import { UseGuards } from '@nestjs/common';
import { Args, ID, Mutation, Parent, Query, ResolveField, Resolver } from '@nestjs/graphql';
import { DataSource } from 'typeorm';
import type { CompanyAccess } from '../../common/access/company-access.js';
import { assertVisibleLocation, visibleLocationIds } from '../../common/access/location-scope.js';
import { CurrentCompanyAccess, CurrentCompanyId } from '../../common/decorators/current-company.decorator.js';
import { CurrentUser } from '../../common/decorators/current-user.decorator.js';
import { IdempotencyKeyHeader } from '../../common/decorators/idempotency-key.decorator.js';
import {
  RequireCompanyMembership,
  RequirePermissions,
} from '../../common/decorators/permissions.decorator.js';
import { PermissionCode } from '../../common/enums/permission-code.enum.js';
import { RecordStatus } from '../../common/enums/record-status.enum.js';
import { CsrfGuard } from '../../common/guards/csrf.guard.js';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard.js';
import { PermissionsGuard } from '../../common/guards/permissions.guard.js';
import type { JwtPayload } from '../auth/interface/jwt-payload.interface.js';
import { CreateInventoryLocationInput } from './dto/create-inventory-location.input.js';
import { InventoryLocationObjectType } from './dto/inventory-location.object-type.js';
import { InventoryLocationType } from './entities/inventory-location-type.enum.js';
import type { InventoryLocation } from './entities/inventory-location.entity.js';
import { InventoryLocationService } from './inventory-location.service.js';

@Resolver(() => InventoryLocationObjectType)
@UseGuards(JwtAuthGuard, PermissionsGuard, CsrfGuard)
export class InventoryLocationResolver {
  constructor(
    private readonly inventoryLocationService: InventoryLocationService,
    private readonly dataSource: DataSource,
  ) {}

  // Quién tiene encima lo que hay en este cajón: el corredor, en un RUNNER. Con esto Inventario
  // nombra su bolsa en vez de mostrarla como una ubicación desconocida.
  @ResolveField(() => String, { nullable: true })
  custodianName(@Parent() inventoryLocation: InventoryLocation): string | null {
    const custodian = inventoryLocation.custodianUser;
    return custodian ? `${custodian.firstName} ${custodian.lastName}`.trim() : null;
  }

  // Solo los cajones de las sedes que tiene asignadas quien consulta; el administrador, todos.
  @Query(() => [InventoryLocationObjectType])
  @RequireCompanyMembership()
  async inventoryLocations(
    @CurrentCompanyId() companyId: string,
    @CurrentUser() user: JwtPayload,
    @CurrentCompanyAccess() access: CompanyAccess,
    @Args('type', { type: () => InventoryLocationType, nullable: true }) type?: InventoryLocationType,
    @Args('locationId', { type: () => ID, nullable: true }) locationId?: string,
    @Args('status', { type: () => RecordStatus, nullable: true }) status?: RecordStatus,
  ) {
    const locationIds = await visibleLocationIds(this.dataSource.manager, companyId, user.sub, access);
    return this.inventoryLocationService.findAll(companyId, { type, locationId, status, locationIds });
  }

  @Query(() => InventoryLocationObjectType)
  @RequireCompanyMembership()
  inventoryLocation(@CurrentCompanyId() companyId: string, @Args('id', { type: () => ID }) id: string) {
    return this.inventoryLocationService.findOne(companyId, id);
  }

  @Mutation(() => InventoryLocationObjectType)
  @RequirePermissions(PermissionCode.INVENTORY_MANAGE_PRODUCTS)
  async createInventoryLocation(
    @CurrentCompanyId() companyId: string,
    @CurrentUser() currentUser: JwtPayload,
    @CurrentCompanyAccess() access: CompanyAccess,
    @Args('input') input: CreateInventoryLocationInput,
    @IdempotencyKeyHeader() idempotencyKey?: string,
  ) {
    // Un cajón se crea en una sede propia: si no se viera, se crearía uno duplicado al lado del que
    // ya tiene (nada impide dos del mismo tipo en la misma sede) y el inventario quedaría partido.
    await assertVisibleLocation(this.dataSource.manager, companyId, currentUser.sub, access, input.locationId ?? null);
    return this.inventoryLocationService.create(companyId, currentUser.sub, input, idempotencyKey);
  }

  @Mutation(() => InventoryLocationObjectType)
  @RequirePermissions(PermissionCode.INVENTORY_MANAGE_PRODUCTS)
  deactivateInventoryLocation(
    @CurrentCompanyId() companyId: string,
    @Args('id', { type: () => ID }) id: string,
  ) {
    return this.inventoryLocationService.deactivate(companyId, id);
  }

  @Mutation(() => InventoryLocationObjectType)
  @RequirePermissions(PermissionCode.INVENTORY_MANAGE_PRODUCTS)
  activateInventoryLocation(
    @CurrentCompanyId() companyId: string,
    @Args('id', { type: () => ID }) id: string,
  ) {
    return this.inventoryLocationService.activate(companyId, id);
  }
}
