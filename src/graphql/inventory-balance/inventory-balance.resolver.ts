import { UseGuards } from '@nestjs/common';
import { Args, ID, Mutation, Query, Resolver } from '@nestjs/graphql';
import { CurrentCompanyId } from '../../common/decorators/current-company.decorator.js';
import { RequireCompanyMembership, RequirePermissions } from '../../common/decorators/permissions.decorator.js';
import { PermissionCode } from '../../common/enums/permission-code.enum.js';
import { CsrfGuard } from '../../common/guards/csrf.guard.js';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard.js';
import { PermissionsGuard } from '../../common/guards/permissions.guard.js';
import { InventoryBalanceObjectType } from './dto/inventory-balance.object-type.js';
import { UpdateInventoryBalanceMinStockInput } from './dto/update-inventory-balance-min-stock.input.js';
import { InventorySide } from './entities/inventory-side.enum.js';
import { InventoryBalanceService } from './inventory-balance.service.js';

// La existencia solo cambia registrando un movimiento (ver InventoryMovementResolver); la única
// mutación de aquí es el mínimo, que no mueve stock.
@Resolver(() => InventoryBalanceObjectType)
@UseGuards(JwtAuthGuard, PermissionsGuard, CsrfGuard)
export class InventoryBalanceResolver {
  constructor(private readonly inventoryBalanceService: InventoryBalanceService) {}

  @Query(() => [InventoryBalanceObjectType])
  @RequireCompanyMembership()
  inventoryBalances(
    @CurrentCompanyId() companyId: string,
    @Args('productVariantId', { type: () => ID, nullable: true }) productVariantId?: string,
    @Args('inventoryLocationId', { type: () => ID, nullable: true }) inventoryLocationId?: string,
    @Args('side', { type: () => InventorySide, nullable: true }) side?: InventorySide,
  ) {
    return this.inventoryBalanceService.findAll(companyId, { productVariantId, inventoryLocationId, side });
  }

  @Query(() => InventoryBalanceObjectType)
  @RequireCompanyMembership()
  inventoryBalance(@CurrentCompanyId() companyId: string, @Args('id', { type: () => ID }) id: string) {
    return this.inventoryBalanceService.findOne(companyId, id);
  }

  @Mutation(() => InventoryBalanceObjectType)
  @RequirePermissions(PermissionCode.INVENTORY_MANAGE_PRODUCTS)
  updateInventoryBalanceMinStock(@CurrentCompanyId() companyId: string, @Args('input') input: UpdateInventoryBalanceMinStockInput) {
    return this.inventoryBalanceService.updateMinStock(companyId, input.id, input.minStock);
  }
}
