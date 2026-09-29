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
import { RecordStatus } from '../../common/enums/record-status.enum.js';
import { CsrfGuard } from '../../common/guards/csrf.guard.js';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard.js';
import { PermissionsGuard } from '../../common/guards/permissions.guard.js';
import type { JwtPayload } from '../auth/interface/jwt-payload.interface.js';
import { CreateInventoryLocationInput } from './dto/create-inventory-location.input.js';
import { InventoryLocationObjectType } from './dto/inventory-location.object-type.js';
import { InventoryLocationType } from './entities/inventory-location-type.enum.js';
import { InventoryLocationService } from './inventory-location.service.js';

@Resolver(() => InventoryLocationObjectType)
@UseGuards(JwtAuthGuard, PermissionsGuard, CsrfGuard)
export class InventoryLocationResolver {
  constructor(private readonly inventoryLocationService: InventoryLocationService) {}

  @Query(() => [InventoryLocationObjectType])
  @RequireCompanyMembership()
  inventoryLocations(
    @CurrentCompanyId() companyId: string,
    @Args('type', { type: () => InventoryLocationType, nullable: true }) type?: InventoryLocationType,
    @Args('locationId', { type: () => ID, nullable: true }) locationId?: string,
    @Args('status', { type: () => RecordStatus, nullable: true }) status?: RecordStatus,
  ) {
    return this.inventoryLocationService.findAll(companyId, { type, locationId, status });
  }

  @Query(() => InventoryLocationObjectType)
  @RequireCompanyMembership()
  inventoryLocation(@CurrentCompanyId() companyId: string, @Args('id', { type: () => ID }) id: string) {
    return this.inventoryLocationService.findOne(companyId, id);
  }

  @Mutation(() => InventoryLocationObjectType)
  @RequirePermissions(PermissionCode.INVENTORY_MANAGE_PRODUCTS)
  createInventoryLocation(
    @CurrentCompanyId() companyId: string,
    @CurrentUser() currentUser: JwtPayload,
    @Args('input') input: CreateInventoryLocationInput,
    @IdempotencyKeyHeader() idempotencyKey?: string,
  ) {
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
