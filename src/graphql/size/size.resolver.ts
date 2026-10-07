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
import { CsrfGuard } from '../../common/guards/csrf.guard.js';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard.js';
import { PermissionsGuard } from '../../common/guards/permissions.guard.js';
import type { JwtPayload } from '../auth/interface/jwt-payload.interface.js';
import { CreateSizeInput } from './dto/create-size.input.js';
import { SizeObjectType } from './dto/size.object-type.js';
import { SizeService } from './size.service.js';

@Resolver(() => SizeObjectType)
@UseGuards(JwtAuthGuard, PermissionsGuard, CsrfGuard)
export class SizeResolver {
  constructor(private readonly sizeService: SizeService) {}

  @Query(() => [SizeObjectType])
  @RequireCompanyMembership()
  sizes() {
    return this.sizeService.findAll();
  }

  @Query(() => SizeObjectType)
  @RequireCompanyMembership()
  size(@Args('id', { type: () => ID }) id: string) {
    return this.sizeService.findOne(id);
  }

  @Mutation(() => SizeObjectType)
  @RequirePermissions(PermissionCode.INVENTORY_MANAGE_PRODUCTS)
  createSize(
    @CurrentCompanyId() companyId: string,
    @CurrentUser() currentUser: JwtPayload,
    @Args('input') input: CreateSizeInput,
    @IdempotencyKeyHeader() idempotencyKey?: string,
  ) {
    return this.sizeService.create(companyId, currentUser.sub, input, idempotencyKey);
  }
}
