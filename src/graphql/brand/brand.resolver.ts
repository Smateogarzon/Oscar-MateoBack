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
import { BrandService } from './brand.service.js';
import { BrandObjectType } from './dto/brand.object-type.js';
import { CreateBrandInput } from './dto/create-brand.input.js';
import { UpdateBrandInput } from './dto/update-brand.input.js';

// El catálogo es de la plataforma, no de una empresa (ver brand.entity.ts): por eso ninguna
// consulta ni mutación recibe o filtra por companyId. `@RequireCompanyMembership()` en las
// lecturas solo exige una sesión válida trabajando en alguna empresa activa, como cualquier otra
// pantalla; escribir exige el permiso de catálogo (hoy, solo el super administrador lo tiene).
@Resolver(() => BrandObjectType)
@UseGuards(JwtAuthGuard, PermissionsGuard, CsrfGuard)
export class BrandResolver {
  constructor(private readonly brandService: BrandService) {}

  @Query(() => [BrandObjectType])
  @RequireCompanyMembership()
  brands(@Args('status', { type: () => RecordStatus, nullable: true }) status?: RecordStatus) {
    return this.brandService.findAll(status);
  }

  @Query(() => BrandObjectType)
  @RequireCompanyMembership()
  brand(@Args('id', { type: () => ID }) id: string) {
    return this.brandService.findOne(id);
  }

  @Mutation(() => BrandObjectType)
  @RequirePermissions(PermissionCode.INVENTORY_MANAGE_CATALOG)
  createBrand(
    @CurrentCompanyId() companyId: string,
    @CurrentUser() currentUser: JwtPayload,
    @Args('input') input: CreateBrandInput,
    @IdempotencyKeyHeader() idempotencyKey?: string,
  ) {
    return this.brandService.create(companyId, currentUser.sub, input, idempotencyKey);
  }

  @Mutation(() => BrandObjectType)
  @RequirePermissions(PermissionCode.INVENTORY_MANAGE_CATALOG)
  updateBrand(@Args('id', { type: () => ID }) id: string, @Args('input') input: UpdateBrandInput) {
    return this.brandService.update(id, input);
  }

  @Mutation(() => BrandObjectType)
  @RequirePermissions(PermissionCode.INVENTORY_MANAGE_CATALOG)
  deactivateBrand(@Args('id', { type: () => ID }) id: string) {
    return this.brandService.deactivate(id);
  }

  @Mutation(() => BrandObjectType)
  @RequirePermissions(PermissionCode.INVENTORY_MANAGE_CATALOG)
  activateBrand(@Args('id', { type: () => ID }) id: string) {
    return this.brandService.activate(id);
  }
}
