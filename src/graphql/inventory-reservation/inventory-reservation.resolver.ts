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
import { CreateInventoryReservationInput } from './dto/create-inventory-reservation.input.js';
import { InventoryReservationObjectType } from './dto/inventory-reservation.object-type.js';
import { InventoryReservationService } from './inventory-reservation.service.js';

@Resolver(() => InventoryReservationObjectType)
@UseGuards(JwtAuthGuard, PermissionsGuard, CsrfGuard)
export class InventoryReservationResolver {
  constructor(private readonly inventoryReservationService: InventoryReservationService) {}

  @Query(() => [InventoryReservationObjectType])
  @RequireCompanyMembership()
  inventoryReservations(
    @CurrentCompanyId() companyId: string,
    @Args('productVariantId', { type: () => ID, nullable: true }) productVariantId?: string,
    @Args('inventoryLocationId', { type: () => ID, nullable: true }) inventoryLocationId?: string,
  ) {
    return this.inventoryReservationService.findAll(companyId, { productVariantId, inventoryLocationId });
  }

  @Query(() => InventoryReservationObjectType)
  @RequireCompanyMembership()
  inventoryReservation(@CurrentCompanyId() companyId: string, @Args('id', { type: () => ID }) id: string) {
    return this.inventoryReservationService.findOne(companyId, id);
  }

  @Mutation(() => InventoryReservationObjectType)
  @RequirePermissions(PermissionCode.INVENTORY_MANAGE_PRODUCTS)
  createInventoryReservation(
    @CurrentCompanyId() companyId: string,
    @CurrentUser() currentUser: JwtPayload,
    @Args('input') input: CreateInventoryReservationInput,
    @IdempotencyKeyHeader() idempotencyKey?: string,
  ) {
    return this.inventoryReservationService.create(companyId, currentUser.sub, input, idempotencyKey);
  }

  @Mutation(() => Boolean)
  @RequirePermissions(PermissionCode.INVENTORY_MANAGE_PRODUCTS)
  async releaseInventoryReservation(
    @CurrentCompanyId() companyId: string,
    @Args('id', { type: () => ID }) id: string,
  ) {
    await this.inventoryReservationService.release(companyId, id);
    return true;
  }
}
