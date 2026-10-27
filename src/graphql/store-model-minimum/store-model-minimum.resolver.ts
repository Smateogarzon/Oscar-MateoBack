import { UseGuards } from '@nestjs/common';
import { Args, ID, Mutation, Query, Resolver } from '@nestjs/graphql';
import { DataSource } from 'typeorm';
import type { CompanyAccess } from '../../common/access/company-access.js';
import { visibleLocationIds } from '../../common/access/location-scope.js';
import { CurrentCompanyAccess, CurrentCompanyId } from '../../common/decorators/current-company.decorator.js';
import { CurrentUser } from '../../common/decorators/current-user.decorator.js';
import { RequireAnyPermission, RequireCompanyMembership } from '../../common/decorators/permissions.decorator.js';
import { PermissionCode } from '../../common/enums/permission-code.enum.js';
import { CsrfGuard } from '../../common/guards/csrf.guard.js';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard.js';
import { PermissionsGuard } from '../../common/guards/permissions.guard.js';
import type { JwtPayload } from '../auth/interface/jwt-payload.interface.js';
import { SetStoreModelMinimumInput } from './dto/set-store-model-minimum.input.js';
import { StoreModelMinimumObjectType } from './dto/store-model-minimum.object-type.js';
import { StoreRestockSuggestionObjectType } from './dto/store-restock-suggestion.object-type.js';
import { StoreModelMinimumService } from './store-model-minimum.service.js';

// Los mínimos de mostrador y el "qué pedir" que sale de ellos. Se leen con solo pertenecer a la
// empresa (es el mismo dato que ya muestra Inventario), acotados a las sedes de quien consulta;
// fijarlos pide poder surtir o manejar el inventario.
@Resolver(() => StoreModelMinimumObjectType)
@UseGuards(JwtAuthGuard, PermissionsGuard, CsrfGuard)
export class StoreModelMinimumResolver {
  constructor(
    private readonly storeModelMinimumService: StoreModelMinimumService,
    private readonly dataSource: DataSource,
  ) {}

  private scope(companyId: string, user: JwtPayload, access: CompanyAccess) {
    return visibleLocationIds(this.dataSource.manager, companyId, user.sub, access);
  }

  @Query(() => [StoreModelMinimumObjectType])
  @RequireCompanyMembership()
  async storeModelMinimums(
    @CurrentCompanyId() companyId: string,
    @CurrentUser() user: JwtPayload,
    @CurrentCompanyAccess() access: CompanyAccess,
    @Args('locationId', { type: () => ID, nullable: true }) locationId?: string,
  ) {
    const locationIds = await this.scope(companyId, user, access);
    return this.storeModelMinimumService.findAll(companyId, { locationId, locationIds });
  }

  // Qué hay que surtir: los modelos bajo su mínimo, con lo que ya viene en camino descontado.
  @Query(() => [StoreRestockSuggestionObjectType])
  @RequireCompanyMembership()
  async storeRestockSuggestions(
    @CurrentCompanyId() companyId: string,
    @CurrentUser() user: JwtPayload,
    @CurrentCompanyAccess() access: CompanyAccess,
    @Args('locationId', { type: () => ID, nullable: true }) locationId?: string,
  ) {
    const locationIds = await this.scope(companyId, user, access);
    return this.storeModelMinimumService.findRestockSuggestions(companyId, { locationId, locationIds });
  }

  // Devuelve null cuando el mínimo se quitó (`minQuantity` vacío): ya no hay fila que devolver.
  @Mutation(() => StoreModelMinimumObjectType, { nullable: true })
  @RequireAnyPermission(PermissionCode.INVENTORY_TRANSFER, PermissionCode.INVENTORY_MANAGE_PRODUCTS)
  async setStoreModelMinimum(
    @CurrentCompanyId() companyId: string,
    @CurrentUser() user: JwtPayload,
    @CurrentCompanyAccess() access: CompanyAccess,
    @Args('input') input: SetStoreModelMinimumInput,
  ) {
    const locationIds = await this.scope(companyId, user, access);
    return this.storeModelMinimumService.set(companyId, input, locationIds);
  }
}
