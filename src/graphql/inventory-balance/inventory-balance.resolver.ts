import { UseGuards } from '@nestjs/common';
import { Args, ID, Mutation, Query, Resolver } from '@nestjs/graphql';
import { DataSource } from 'typeorm';
import type { CompanyAccess } from '../../common/access/company-access.js';
import { visibleLocationIds } from '../../common/access/location-scope.js';
import { CurrentCompanyAccess, CurrentCompanyId } from '../../common/decorators/current-company.decorator.js';
import { CurrentUser } from '../../common/decorators/current-user.decorator.js';
import { RequireCompanyMembership, RequirePermissions } from '../../common/decorators/permissions.decorator.js';
import { PermissionCode } from '../../common/enums/permission-code.enum.js';
import { CsrfGuard } from '../../common/guards/csrf.guard.js';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard.js';
import { PermissionsGuard } from '../../common/guards/permissions.guard.js';
import type { JwtPayload } from '../auth/interface/jwt-payload.interface.js';
import { InventoryBalanceObjectType } from './dto/inventory-balance.object-type.js';
import { SellableStockObjectType } from './dto/sellable-stock.object-type.js';
import { UpdateInventoryBalanceMinStockInput } from './dto/update-inventory-balance-min-stock.input.js';
import { InventoryBalanceService } from './inventory-balance.service.js';

// La existencia solo cambia registrando un movimiento (ver InventoryMovementResolver); la única
// mutación de aquí es el mínimo, que no mueve stock.
@Resolver(() => InventoryBalanceObjectType)
@UseGuards(JwtAuthGuard, PermissionsGuard, CsrfGuard)
export class InventoryBalanceResolver {
  constructor(
    private readonly inventoryBalanceService: InventoryBalanceService,
    private readonly dataSource: DataSource,
  ) {}

  // Las sedes de quien consulta (`null`, todas): el inventario se lee por bodega asignada.
  private scope(companyId: string, user: JwtPayload, access: CompanyAccess) {
    return visibleLocationIds(this.dataSource.manager, companyId, user.sub, access);
  }

  // Solo las existencias de las sedes que tiene asignadas quien consulta; el administrador, todas.
  @Query(() => [InventoryBalanceObjectType])
  @RequireCompanyMembership()
  async inventoryBalances(
    @CurrentCompanyId() companyId: string,
    @CurrentUser() user: JwtPayload,
    @CurrentCompanyAccess() access: CompanyAccess,
    @Args('productVariantId', { type: () => ID, nullable: true }) productVariantId?: string,
    @Args('inventoryLocationId', { type: () => ID, nullable: true }) inventoryLocationId?: string,
  ) {
    const locationIds = await this.scope(companyId, user, access);
    return this.inventoryBalanceService.findAll(companyId, { productVariantId, inventoryLocationId, locationIds });
  }

  @Query(() => InventoryBalanceObjectType)
  @RequireCompanyMembership()
  async inventoryBalance(
    @CurrentCompanyId() companyId: string,
    @CurrentUser() user: JwtPayload,
    @CurrentCompanyAccess() access: CompanyAccess,
    @Args('id', { type: () => ID }) id: string,
  ) {
    return this.inventoryBalanceService.findOne(companyId, id, await this.scope(companyId, user, access));
  }

  // Lo que se puede vender de cada variante (ver InventoryBalanceService.findSellableStock): lo lee
  // el selector de productos de Ventas en vez de recalcularlo con las existencias y las reservas.
  // `storeId` es la tienda donde se está vendiendo: lo que se vende directo (la ropa, o todo en una
  // tienda sin corredores) se cuenta solo en ella, porque de otra tienda nadie lo va a traer.
  @Query(() => [SellableStockObjectType])
  @RequireCompanyMembership()
  sellableStock(
    @CurrentCompanyId() companyId: string,
    @Args('storeId', { type: () => ID, nullable: true }) storeId?: string,
  ) {
    return this.inventoryBalanceService.findSellableStock(companyId, storeId);
  }

  @Mutation(() => InventoryBalanceObjectType)
  @RequirePermissions(PermissionCode.INVENTORY_MANAGE_PRODUCTS)
  async updateInventoryBalanceMinStock(
    @CurrentCompanyId() companyId: string,
    @CurrentUser() user: JwtPayload,
    @CurrentCompanyAccess() access: CompanyAccess,
    @Args('input') input: UpdateInventoryBalanceMinStockInput,
  ) {
    const locationIds = await this.scope(companyId, user, access);
    return this.inventoryBalanceService.updateMinStock(companyId, input.id, input.minStock, locationIds);
  }
}
