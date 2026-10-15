import { ForbiddenException, UseGuards } from '@nestjs/common';
import { Args, ID, Mutation, Query, Resolver } from '@nestjs/graphql';
import {
  CurrentCompanyAccess,
  CurrentCompanyId,
} from '../../common/decorators/current-company.decorator.js';
import { CurrentUser } from '../../common/decorators/current-user.decorator.js';
import { IdempotencyKeyHeader } from '../../common/decorators/idempotency-key.decorator.js';
import {
  RequireAnyPermission,
  RequireCompanyMembership,
} from '../../common/decorators/permissions.decorator.js';
import { PermissionCode } from '../../common/enums/permission-code.enum.js';
import { visibleLocationIds } from '../../common/access/location-scope.js';
import { CsrfGuard } from '../../common/guards/csrf.guard.js';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard.js';
import { PermissionsGuard } from '../../common/guards/permissions.guard.js';
import type { CompanyAccess } from '../../common/access/company-access.js';
import type { JwtPayload } from '../auth/interface/jwt-payload.interface.js';
import { DataSource } from 'typeorm';
import { CreateInventoryMovementInput } from './dto/create-inventory-movement.input.js';
import { InventoryMovementObjectType } from './dto/inventory-movement.object-type.js';
import { InventoryMovementType } from './entities/inventory-movement-type.enum.js';
import { InventoryMovementService } from './inventory-movement.service.js';

@Resolver(() => InventoryMovementObjectType)
@UseGuards(JwtAuthGuard, PermissionsGuard, CsrfGuard)
export class InventoryMovementResolver {
  constructor(
    private readonly inventoryMovementService: InventoryMovementService,
    private readonly dataSource: DataSource,
  ) {}

  // Solo los movimientos que pasaron por una sede de quien consulta; el administrador, todos.
  @Query(() => [InventoryMovementObjectType])
  @RequireCompanyMembership()
  async inventoryMovements(
    @CurrentCompanyId() companyId: string,
    @CurrentUser() user: JwtPayload,
    @CurrentCompanyAccess() access: CompanyAccess,
    @Args('productVariantId', { type: () => ID, nullable: true }) productVariantId?: string,
    @Args('fromLocationId', { type: () => ID, nullable: true }) fromLocationId?: string,
    @Args('toLocationId', { type: () => ID, nullable: true }) toLocationId?: string,
  ) {
    const locationIds = await visibleLocationIds(this.dataSource.manager, companyId, user.sub, access);
    return this.inventoryMovementService.findAll(companyId, { productVariantId, fromLocationId, toLocationId, locationIds });
  }

  @Query(() => InventoryMovementObjectType)
  @RequireCompanyMembership()
  inventoryMovement(@CurrentCompanyId() companyId: string, @Args('id', { type: () => ID }) id: string) {
    return this.inventoryMovementService.findOne(companyId, id);
  }

  // Dos permisos distintos según lo que se mueva, y por eso el guard solo exige uno cualquiera de
  // los dos: el traslado entre tiendas y bodegas es de INVENTORY_TRANSFER (su módulo completo), y
  // todo lo demás (ajustes, bajas, cargues) sigue siendo de INVENTORY_MANAGE_PRODUCTS. Tener uno
  // no da el otro: quien solo traslada no ajusta stock, y quien solo administra no traslada.
  @Mutation(() => InventoryMovementObjectType)
  @RequireAnyPermission(PermissionCode.INVENTORY_MANAGE_PRODUCTS, PermissionCode.INVENTORY_TRANSFER)
  recordInventoryMovement(
    @CurrentCompanyId() companyId: string,
    @CurrentCompanyAccess() access: CompanyAccess,
    @CurrentUser() currentUser: JwtPayload,
    @Args('input') input: CreateInventoryMovementInput,
    @IdempotencyKeyHeader() idempotencyKey?: string,
  ) {
    const required =
      input.type === InventoryMovementType.TRANSFER
        ? PermissionCode.INVENTORY_TRANSFER
        : PermissionCode.INVENTORY_MANAGE_PRODUCTS;
    if (!access.permissionCodes.includes(required)) {
      throw new ForbiddenException(
        input.type === InventoryMovementType.TRANSFER
          ? 'No tienes permiso para hacer transferencias'
          : 'No tienes permiso para mover el inventario',
      );
    }
    return this.inventoryMovementService.record(companyId, currentUser.sub, input, idempotencyKey);
  }
}
