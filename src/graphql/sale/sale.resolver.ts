import { UseGuards } from '@nestjs/common';
import { Args, ID, Int, Mutation, Parent, Query, ResolveField, Resolver } from '@nestjs/graphql';
import type { CompanyAccess } from '../../common/access/company-access.js';
import {
  CurrentCompanyAccess,
  CurrentCompanyId,
} from '../../common/decorators/current-company.decorator.js';
import { CurrentUser } from '../../common/decorators/current-user.decorator.js';
import { RequirePermissions } from '../../common/decorators/permissions.decorator.js';
import { PermissionCode } from '../../common/enums/permission-code.enum.js';
import { CsrfGuard } from '../../common/guards/csrf.guard.js';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard.js';
import { PermissionsGuard } from '../../common/guards/permissions.guard.js';
import type { JwtPayload } from '../auth/interface/jwt-payload.interface.js';
import { cashActor } from '../cash-session/cash-actor.js';
import { AddSaleItemInput } from './dto/add-sale-item.input.js';
import { CancelSaleInput } from './dto/cancel-sale.input.js';
import { CreateSaleInput } from './dto/create-sale.input.js';
import { SaleItemObjectType } from './dto/sale-item.object-type.js';
import { SaleObjectType } from './dto/sale.object-type.js';
import { UpdateSaleItemQuantityInput } from './dto/update-sale-item-quantity.input.js';
import { saleActor } from './sale-actor.js';
import { SaleStatus } from './entities/sale-status.enum.js';
import { SaleService } from './sale.service.js';

@Resolver(() => SaleObjectType)
@UseGuards(JwtAuthGuard, PermissionsGuard, CsrfGuard)
export class SaleResolver {
  constructor(private readonly saleService: SaleService) {}

  // El histórico de ventas: cada cajero o vendedor ve las que cobró o vendió; quien tiene
  // sales.view_all ve las de todos y puede además filtrar por un cajero concreto.
  @Query(() => [SaleObjectType])
  @RequirePermissions(PermissionCode.SALES_VIEW)
  sales(
    @CurrentCompanyId() companyId: string,
    @CurrentCompanyAccess() access: CompanyAccess,
    @CurrentUser() currentUser: JwtPayload,
    @Args('status', { type: () => SaleStatus, nullable: true }) status?: SaleStatus,
    @Args('storeId', { type: () => ID, nullable: true }) storeId?: string,
    @Args('cashierId', { type: () => ID, nullable: true }) cashierId?: string,
  ) {
    return this.saleService.findAll(
      companyId,
      saleActor(currentUser.sub, access.permissionCodes),
      { status, storeId, cashierId },
    );
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

  // Cuántas líneas tiene, para listas (la cola de "Ventas en curso") sin traerlas todas.
  @ResolveField(() => Int)
  itemCount(@Parent() sale: SaleObjectType) {
    return this.saleService.countItems(sale.id);
  }

  // "Nueva venta" del cajero: el cajero es el usuario de la sesión. Queda atada al turno que
  // manda `input.cashSessionId` desde que nace (SaleService.create lo valida y bloquea).
  @Mutation(() => SaleObjectType)
  @RequirePermissions(PermissionCode.SALES_CREATE)
  createSale(
    @CurrentCompanyId() companyId: string,
    @CurrentCompanyAccess() access: CompanyAccess,
    @CurrentUser() currentUser: JwtPayload,
    @Args('input') input: CreateSaleInput,
  ) {
    return this.saleService.create(companyId, cashActor(currentUser.sub, access.permissionCodes), input);
  }

  // Armar la venta es parte de crearla: quien puede crearla puede agregar y quitar líneas y
  // cambiar su cantidad mientras siga en borrador. Devuelven la venta con los totales
  // recalculados. Los descuentos no se aplican aquí: pasan por una solicitud
  // (DiscountRequestResolver).
  //
  // Llevan el usuario porque el servicio comprueba en cada una que siga teniendo acceso a la tienda
  // de la venta: si se lo quitan con la venta a medias, deja de poder tocarla en ese momento.
  @Mutation(() => SaleObjectType)
  @RequirePermissions(PermissionCode.SALES_CREATE)
  addSaleItem(
    @CurrentCompanyId() companyId: string,
    @CurrentUser() currentUser: JwtPayload,
    @Args('input') input: AddSaleItemInput,
  ) {
    return this.saleService.addItem(companyId, currentUser.sub, input);
  }

  @Mutation(() => SaleObjectType)
  @RequirePermissions(PermissionCode.SALES_CREATE)
  updateSaleItemQuantity(
    @CurrentCompanyId() companyId: string,
    @CurrentUser() currentUser: JwtPayload,
    @Args('input') input: UpdateSaleItemQuantityInput,
  ) {
    return this.saleService.updateItemQuantity(companyId, currentUser.sub, input);
  }

  @Mutation(() => SaleObjectType)
  @RequirePermissions(PermissionCode.SALES_CREATE)
  removeSaleItem(
    @CurrentCompanyId() companyId: string,
    @CurrentUser() currentUser: JwtPayload,
    @Args('saleId', { type: () => ID }) saleId: string,
    @Args('itemId', { type: () => ID }) itemId: string,
  ) {
    return this.saleService.removeItem(companyId, currentUser.sub, saleId, itemId);
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
