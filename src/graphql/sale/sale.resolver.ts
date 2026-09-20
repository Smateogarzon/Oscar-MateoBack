import { UseGuards } from '@nestjs/common';
import { Args, ID, Mutation, Query, Resolver } from '@nestjs/graphql';
import { CurrentCompanyId } from '../../common/decorators/current-company.decorator.js';
import { CurrentUser } from '../../common/decorators/current-user.decorator.js';
import { RequirePermissions } from '../../common/decorators/permissions.decorator.js';
import { PermissionCode } from '../../common/enums/permission-code.enum.js';
import { CsrfGuard } from '../../common/guards/csrf.guard.js';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard.js';
import { PermissionsGuard } from '../../common/guards/permissions.guard.js';
import type { JwtPayload } from '../auth/interface/jwt-payload.interface.js';
import { AddSaleItemInput } from './dto/add-sale-item.input.js';
import { CancelSaleInput } from './dto/cancel-sale.input.js';
import { CreateSaleInput } from './dto/create-sale.input.js';
import { SaleItemObjectType } from './dto/sale-item.object-type.js';
import { SaleObjectType } from './dto/sale.object-type.js';
import { UpdateSaleItemQuantityInput } from './dto/update-sale-item-quantity.input.js';
import { SaleStatus } from './entities/sale-status.enum.js';
import { SaleService } from './sale.service.js';

@Resolver(() => SaleObjectType)
@UseGuards(JwtAuthGuard, PermissionsGuard, CsrfGuard)
export class SaleResolver {
  constructor(private readonly saleService: SaleService) {}

  @Query(() => [SaleObjectType])
  @RequirePermissions(PermissionCode.SALES_VIEW)
  sales(
    @CurrentCompanyId() companyId: string,
    @Args('status', { type: () => SaleStatus, nullable: true }) status?: SaleStatus,
    @Args('storeId', { type: () => ID, nullable: true }) storeId?: string,
  ) {
    return this.saleService.findAll(companyId, { status, storeId });
  }

  @Query(() => SaleObjectType)
  @RequirePermissions(PermissionCode.SALES_VIEW)
  sale(
    @CurrentCompanyId() companyId: string,
    @Args('id', { type: () => ID }) id: string,
  ) {
    return this.saleService.findOne(companyId, id);
  }

  // Las líneas de una venta. Va como consulta aparte y no como campo de Sale para no repetir
  // los guards por cada venta de un listado.
  @Query(() => [SaleItemObjectType])
  @RequirePermissions(PermissionCode.SALES_VIEW)
  saleItems(
    @CurrentCompanyId() companyId: string,
    @Args('saleId', { type: () => ID }) saleId: string,
  ) {
    return this.saleService.findItems(companyId, saleId);
  }

  // "Nueva venta" del cajero: el cajero es el usuario de la sesión.
  @Mutation(() => SaleObjectType)
  @RequirePermissions(PermissionCode.SALES_CREATE)
  createSale(
    @CurrentCompanyId() companyId: string,
    @CurrentUser() currentUser: JwtPayload,
    @Args('input') input: CreateSaleInput,
  ) {
    return this.saleService.create(companyId, currentUser.sub, input);
  }

  // Armar la venta es parte de crearla: quien puede crearla puede agregar y quitar líneas y
  // cambiar su cantidad mientras siga en borrador. Devuelven la venta con los totales
  // recalculados. Los descuentos no se aplican aquí: pasan por una solicitud
  // (DiscountRequestResolver).
  @Mutation(() => SaleObjectType)
  @RequirePermissions(PermissionCode.SALES_CREATE)
  addSaleItem(
    @CurrentCompanyId() companyId: string,
    @Args('input') input: AddSaleItemInput,
  ) {
    return this.saleService.addItem(companyId, input);
  }

  @Mutation(() => SaleObjectType)
  @RequirePermissions(PermissionCode.SALES_CREATE)
  updateSaleItemQuantity(
    @CurrentCompanyId() companyId: string,
    @Args('input') input: UpdateSaleItemQuantityInput,
  ) {
    return this.saleService.updateItemQuantity(companyId, input);
  }

  @Mutation(() => SaleObjectType)
  @RequirePermissions(PermissionCode.SALES_CREATE)
  removeSaleItem(
    @CurrentCompanyId() companyId: string,
    @Args('saleId', { type: () => ID }) saleId: string,
    @Args('itemId', { type: () => ID }) itemId: string,
  ) {
    return this.saleService.removeItem(companyId, saleId, itemId);
  }

  @Mutation(() => SaleObjectType)
  @RequirePermissions(PermissionCode.SALES_CANCEL)
  cancelSale(
    @CurrentCompanyId() companyId: string,
    @CurrentUser() currentUser: JwtPayload,
    @Args('id', { type: () => ID }) id: string,
    @Args('input') input: CancelSaleInput,
  ) {
    return this.saleService.cancel(companyId, currentUser.sub, id, input);
  }
}
