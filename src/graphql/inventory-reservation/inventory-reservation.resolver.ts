import { UseGuards } from '@nestjs/common';
import { Args, ID, Parent, Query, ResolveField, Resolver } from '@nestjs/graphql';
import { DataSource } from 'typeorm';
import type { CompanyAccess } from '../../common/access/company-access.js';
import { visibleLocationIds } from '../../common/access/location-scope.js';
import { CurrentCompanyAccess, CurrentCompanyId } from '../../common/decorators/current-company.decorator.js';
import { CurrentUser } from '../../common/decorators/current-user.decorator.js';
import { RequireCompanyMembership } from '../../common/decorators/permissions.decorator.js';
import type { JwtPayload } from '../auth/interface/jwt-payload.interface.js';
import { fullName } from '../../common/utils/text.js';
import { CsrfGuard } from '../../common/guards/csrf.guard.js';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard.js';
import { PermissionsGuard } from '../../common/guards/permissions.guard.js';
import { InventoryReservationObjectType } from './dto/inventory-reservation.object-type.js';
import { InventoryReservation } from './entities/inventory-reservation.entity.js';
import { InventoryReservationService } from './inventory-reservation.service.js';

@Resolver(() => InventoryReservationObjectType)
@UseGuards(JwtAuthGuard, PermissionsGuard, CsrfGuard)
export class InventoryReservationResolver {
  constructor(
    private readonly inventoryReservationService: InventoryReservationService,
    private readonly dataSource: DataSource,
  ) {}

  @Query(() => [InventoryReservationObjectType])
  @RequireCompanyMembership()
  async inventoryReservations(
    @CurrentCompanyId() companyId: string,
    @CurrentUser() user: JwtPayload,
    @CurrentCompanyAccess() access: CompanyAccess,
    @Args('productVariantId', { type: () => ID, nullable: true }) productVariantId?: string,
    @Args('inventoryLocationId', { type: () => ID, nullable: true }) inventoryLocationId?: string,
  ) {
    const locationIds = await visibleLocationIds(this.dataSource.manager, companyId, user.sub, access);
    return this.inventoryReservationService.findAll(companyId, { productVariantId, inventoryLocationId, locationIds });
  }

  @Query(() => InventoryReservationObjectType)
  @RequireCompanyMembership()
  inventoryReservation(@CurrentCompanyId() companyId: string, @Args('id', { type: () => ID }) id: string) {
    return this.inventoryReservationService.findOne(companyId, id);
  }

  // Quién la tiene apartada, con nombre: es lo que hay que mostrarle al vendedor que se encuentra el
  // último par bloqueado. Sale de la relación que ya trae la consulta, sin ir otra vez a la base.
  @ResolveField(() => String, { nullable: true })
  reservedByName(@Parent() reservation: InventoryReservation): string | null {
    const user = reservation.reservedByUser;
    return user ? fullName(user) : null;
  }

}
