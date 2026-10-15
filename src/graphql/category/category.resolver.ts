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
import { CategoryService } from './category.service.js';
import { CategoryObjectType } from './dto/category.object-type.js';
import { CreateCategoryInput } from './dto/create-category.input.js';
import { UpdateCategoryInput } from './dto/update-category.input.js';

@Resolver(() => CategoryObjectType)
@UseGuards(JwtAuthGuard, PermissionsGuard, CsrfGuard)
export class CategoryResolver {
  constructor(private readonly categoryService: CategoryService) {}

  // Cualquier miembro ve las categorías de su empresa (las va a necesitar la pantalla de
  // productos); `parentId: null` trae solo las raíz, sin mandarlo trae todas.
  @Query(() => [CategoryObjectType])
  @RequireCompanyMembership()
  categories(
    @CurrentCompanyId() companyId: string,
    @Args('status', { type: () => RecordStatus, nullable: true }) status?: RecordStatus,
    @Args('parentId', { type: () => ID, nullable: true }) parentId?: string | null,
  ) {
    return this.categoryService.findAll(companyId, status, parentId);
  }

  @Query(() => CategoryObjectType)
  @RequireCompanyMembership()
  category(@CurrentCompanyId() companyId: string, @Args('id', { type: () => ID }) id: string) {
    return this.categoryService.findOne(companyId, id);
  }

  @Mutation(() => CategoryObjectType)
  @RequirePermissions(PermissionCode.INVENTORY_MANAGE_PRODUCTS)
  createCategory(
    @CurrentCompanyId() companyId: string,
    @CurrentUser() currentUser: JwtPayload,
    @Args('input') input: CreateCategoryInput,
    @IdempotencyKeyHeader() idempotencyKey?: string,
  ) {
    return this.categoryService.create(companyId, currentUser.sub, input, idempotencyKey);
  }

  @Mutation(() => CategoryObjectType)
  @RequirePermissions(PermissionCode.INVENTORY_MANAGE_PRODUCTS)
  updateCategory(
    @CurrentCompanyId() companyId: string,
    @Args('id', { type: () => ID }) id: string,
    @Args('input') input: UpdateCategoryInput,
  ) {
    return this.categoryService.update(companyId, id, input);
  }

  @Mutation(() => CategoryObjectType)
  @RequirePermissions(PermissionCode.INVENTORY_MANAGE_PRODUCTS)
  deactivateCategory(@CurrentCompanyId() companyId: string, @Args('id', { type: () => ID }) id: string) {
    return this.categoryService.deactivate(companyId, id);
  }

  @Mutation(() => CategoryObjectType)
  @RequirePermissions(PermissionCode.INVENTORY_MANAGE_PRODUCTS)
  activateCategory(@CurrentCompanyId() companyId: string, @Args('id', { type: () => ID }) id: string) {
    return this.categoryService.activate(companyId, id);
  }
}
