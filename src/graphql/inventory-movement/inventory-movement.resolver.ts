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
import { CreateInventoryMovementInput } from './dto/create-inventory-movement.input.js';
import { InventoryMovementObjectType } from './dto/inventory-movement.object-type.js';
import { InventoryMovementService } from './inventory-movement.service.js';

@Resolver(() => InventoryMovementObjectType)
@UseGuards(JwtAuthGuard, PermissionsGuard, CsrfGuard)
export class InventoryMovementResolver {
  constructor(private readonly inventoryMovementService: InventoryMovementService) {}

  @Query(() => [InventoryMovementObjectType])
  @RequireCompanyMembership()
  inventoryMovements(
    @CurrentCompanyId() companyId: string,
    @Args('productVariantId', { type: () => ID, nullable: true }) productVariantId?: string,
    @Args('fromLocationId', { type: () => ID, nullable: true }) fromLocationId?: string,
    @Args('toLocationId', { type: () => ID, nullable: true }) toLocationId?: string,
  ) {
    return this.inventoryMovementService.findAll(companyId, { productVariantId, fromLocationId, toLocationId });
  }

  @Query(() => InventoryMovementObjectType)
  @RequireCompanyMembership()
  inventoryMovement(@CurrentCompanyId() companyId: string, @Args('id', { type: () => ID }) id: string) {
    return this.inventoryMovementService.findOne(companyId, id);
  }

  @Mutation(() => InventoryMovementObjectType)
  @RequirePermissions(PermissionCode.INVENTORY_MANAGE_PRODUCTS)
  recordInventoryMovement(
    @CurrentCompanyId() companyId: string,
    @CurrentUser() currentUser: JwtPayload,
    @Args('input') input: CreateInventoryMovementInput,
    @IdempotencyKeyHeader() idempotencyKey?: string,
  ) {
    return this.inventoryMovementService.record(companyId, currentUser.sub, input, idempotencyKey);
  }
}
