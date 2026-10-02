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
import { ColorService } from './color.service.js';
import { ColorObjectType } from './dto/color.object-type.js';
import { CreateColorInput } from './dto/create-color.input.js';

@Resolver(() => ColorObjectType)
@UseGuards(JwtAuthGuard, PermissionsGuard, CsrfGuard)
export class ColorResolver {
  constructor(private readonly colorService: ColorService) {}

  @Query(() => [ColorObjectType])
  @RequireCompanyMembership()
  colors() {
    return this.colorService.findAll();
  }

  @Query(() => ColorObjectType)
  @RequireCompanyMembership()
  color(@Args('id', { type: () => ID }) id: string) {
    return this.colorService.findOne(id);
  }

  @Mutation(() => ColorObjectType)
  @RequirePermissions(PermissionCode.INVENTORY_MANAGE_PRODUCTS)
  createColor(
    @CurrentCompanyId() companyId: string,
    @CurrentUser() currentUser: JwtPayload,
    @Args('input') input: CreateColorInput,
    @IdempotencyKeyHeader() idempotencyKey?: string,
  ) {
    return this.colorService.create(companyId, currentUser.sub, input, idempotencyKey);
  }
}
