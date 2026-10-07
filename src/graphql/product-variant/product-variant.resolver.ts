import { UseGuards } from '@nestjs/common';
import { Args, ID, Mutation, Query, Resolver } from '@nestjs/graphql';
import { CurrentCompanyId } from '../../common/decorators/current-company.decorator.js';
import { CurrentUser } from '../../common/decorators/current-user.decorator.js';
import { IdempotencyKeyHeader } from '../../common/decorators/idempotency-key.decorator.js';
import {
  RequireAnyPermission,
  RequireCompanyMembership,
  RequirePermissions,
} from '../../common/decorators/permissions.decorator.js';
import { PermissionCode } from '../../common/enums/permission-code.enum.js';
import { RecordStatus } from '../../common/enums/record-status.enum.js';
import { CsrfGuard } from '../../common/guards/csrf.guard.js';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard.js';
import { PermissionsGuard } from '../../common/guards/permissions.guard.js';
import type { JwtPayload } from '../auth/interface/jwt-payload.interface.js';
import { CreateProductVariantInput } from './dto/create-product-variant.input.js';
import { ProductVariantObjectType } from './dto/product-variant.object-type.js';
import { UpdateProductVariantInput } from './dto/update-product-variant.input.js';
import { ProductVariantService } from './product-variant.service.js';

@Resolver(() => ProductVariantObjectType)
@UseGuards(JwtAuthGuard, PermissionsGuard, CsrfGuard)
export class ProductVariantResolver {
  constructor(private readonly productVariantService: ProductVariantService) {}

  @Query(() => [ProductVariantObjectType])
  @RequireCompanyMembership()
  productVariants(
    @CurrentCompanyId() companyId: string,
    @Args('productId', { type: () => ID, nullable: true }) productId?: string,
    @Args('status', { type: () => RecordStatus, nullable: true }) status?: RecordStatus,
  ) {
    return this.productVariantService.findAll(companyId, { productId, status });
  }

  @Query(() => ProductVariantObjectType)
  @RequireCompanyMembership()
  productVariant(@CurrentCompanyId() companyId: string, @Args('id', { type: () => ID }) id: string) {
    return this.productVariantService.findOne(companyId, id);
  }

  // Igual que createProduct: el administrador o el proveedor pueden dar de alta una variante.
  @Mutation(() => ProductVariantObjectType)
  @RequireAnyPermission(PermissionCode.INVENTORY_MANAGE_PRODUCTS, PermissionCode.SUPPLIERS_CREATE_REFERENCES)
  createProductVariant(
    @CurrentCompanyId() companyId: string,
    @CurrentUser() currentUser: JwtPayload,
    @Args('input') input: CreateProductVariantInput,
    @IdempotencyKeyHeader() idempotencyKey?: string,
  ) {
    return this.productVariantService.create(companyId, currentUser.sub, input, idempotencyKey);
  }

  @Mutation(() => ProductVariantObjectType)
  @RequirePermissions(PermissionCode.INVENTORY_MANAGE_PRODUCTS)
  updateProductVariant(
    @CurrentCompanyId() companyId: string,
    @Args('id', { type: () => ID }) id: string,
    @Args('input') input: UpdateProductVariantInput,
  ) {
    return this.productVariantService.update(companyId, id, input);
  }

  @Mutation(() => ProductVariantObjectType)
  @RequirePermissions(PermissionCode.INVENTORY_MANAGE_PRODUCTS)
  deactivateProductVariant(
    @CurrentCompanyId() companyId: string,
    @Args('id', { type: () => ID }) id: string,
  ) {
    return this.productVariantService.deactivate(companyId, id);
  }

  @Mutation(() => ProductVariantObjectType)
  @RequirePermissions(PermissionCode.INVENTORY_MANAGE_PRODUCTS)
  activateProductVariant(
    @CurrentCompanyId() companyId: string,
    @Args('id', { type: () => ID }) id: string,
  ) {
    return this.productVariantService.activate(companyId, id);
  }
}
