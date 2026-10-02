import { UseGuards } from '@nestjs/common';
import { Args, ID, Mutation, Query, Resolver } from '@nestjs/graphql';
import type { CompanyAccess } from '../../common/access/company-access.js';
import { CurrentCompanyAccess, CurrentCompanyId } from '../../common/decorators/current-company.decorator.js';
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
import { CreateProductInput } from './dto/create-product.input.js';
import { ProductObjectType } from './dto/product.object-type.js';
import { SimilarProductMatchObjectType } from './dto/similar-product-match.object-type.js';
import { UpdateProductInput } from './dto/update-product.input.js';
import { ProductService } from './product.service.js';

@Resolver(() => ProductObjectType)
@UseGuards(JwtAuthGuard, PermissionsGuard, CsrfGuard)
export class ProductResolver {
  constructor(private readonly productService: ProductService) {}

  @Query(() => [ProductObjectType])
  @RequireCompanyMembership()
  products(
    @CurrentCompanyId() companyId: string,
    @Args('status', { type: () => RecordStatus, nullable: true }) status?: RecordStatus,
    @Args('categoryId', { type: () => ID, nullable: true }) categoryId?: string,
    @Args('brandId', { type: () => ID, nullable: true }) brandId?: string,
  ) {
    return this.productService.findAll(companyId, { status, categoryId, brandId });
  }

  @Query(() => ProductObjectType)
  @RequireCompanyMembership()
  product(@CurrentCompanyId() companyId: string, @Args('id', { type: () => ID }) id: string) {
    return this.productService.findOne(companyId, id);
  }

  // Para que el front avise "¿quisiste decir...?" mientras el trabajador escribe el nombre, antes
  // de que llegue a intentar crear (createProduct hace el mismo chequeo, pero bloqueando).
  @Query(() => [SimilarProductMatchObjectType])
  @RequireCompanyMembership()
  similarProducts(@CurrentCompanyId() companyId: string, @Args('name') name: string) {
    return this.productService.findSimilarByName(companyId, name);
  }

  @Mutation(() => ProductObjectType)
  @RequirePermissions(PermissionCode.INVENTORY_MANAGE_PRODUCTS)
  createProduct(
    @CurrentCompanyId() companyId: string,
    @CurrentUser() currentUser: JwtPayload,
    @Args('input') input: CreateProductInput,
    @IdempotencyKeyHeader() idempotencyKey?: string,
  ) {
    return this.productService.create(companyId, currentUser.sub, input, idempotencyKey);
  }

  @Mutation(() => ProductObjectType)
  @RequirePermissions(PermissionCode.INVENTORY_MANAGE_PRODUCTS)
  updateProduct(
    @CurrentCompanyId() companyId: string,
    @Args('id', { type: () => ID }) id: string,
    @Args('input') input: UpdateProductInput,
  ) {
    return this.productService.update(companyId, id, input);
  }

  @Mutation(() => ProductObjectType)
  @RequirePermissions(PermissionCode.INVENTORY_MANAGE_PRODUCTS)
  deactivateProduct(@CurrentCompanyId() companyId: string, @Args('id', { type: () => ID }) id: string) {
    return this.productService.deactivate(companyId, id);
  }

  @Mutation(() => ProductObjectType)
  @RequirePermissions(PermissionCode.INVENTORY_MANAGE_PRODUCTS)
  activateProduct(@CurrentCompanyId() companyId: string, @Args('id', { type: () => ID }) id: string) {
    return this.productService.activate(companyId, id);
  }

  // El botón "Eliminar referencia": quien tiene inventory.manage_products la borra directo (sin
  // pasar por una solicitud). Con el rol SUPER_ADMIN y sin historial de movimientos, se borra de
  // verdad; si no, se desactiva (ver ProductService.deleteReference).
  @Mutation(() => ProductObjectType)
  @RequirePermissions(PermissionCode.INVENTORY_MANAGE_PRODUCTS)
  deleteProductReference(
    @CurrentCompanyId() companyId: string,
    @CurrentCompanyAccess() access: CompanyAccess,
    @Args('id', { type: () => ID }) id: string,
  ) {
    return this.productService.deleteReference(companyId, access.roleCodes, id);
  }
}
