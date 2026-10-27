import { UseGuards } from '@nestjs/common';
import { Args, Mutation, Query, Resolver } from '@nestjs/graphql';
import { CurrentCompanyId } from '../common/decorators/current-company.decorator.js';
import { CurrentUser } from '../common/decorators/current-user.decorator.js';
import { AuthOnly, RequireCompanyMembership } from '../common/decorators/permissions.decorator.js';
import { CsrfGuard } from '../common/guards/csrf.guard.js';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard.js';
import { PermissionsGuard } from '../common/guards/permissions.guard.js';
import type { JwtPayload } from '../graphql/auth/interface/jwt-payload.interface.js';
import { PushConfigObjectType, RegisterPushSubscriptionInput } from './dto/push.dto.js';
import { PushService } from './push.service.js';

// Los avisos del sistema son de cada persona: cualquier miembro de la empresa activa registra y quita
// sus propios dispositivos, y solo los suyos. No hay un permiso aparte.
@Resolver()
@UseGuards(JwtAuthGuard, PermissionsGuard, CsrfGuard)
export class PushResolver {
  constructor(private readonly push: PushService) {}

  // Pública para cualquier sesión: la llave no es un secreto, y el navegador la necesita antes de elegir
  // una empresa.
  @Query(() => PushConfigObjectType)
  @AuthOnly()
  pushConfig(): PushConfigObjectType {
    return { publicKey: this.push.vapidPublicKey() };
  }

  @Mutation(() => Boolean)
  @RequireCompanyMembership()
  async registerPushSubscription(
    @CurrentCompanyId() companyId: string,
    @CurrentUser() currentUser: JwtPayload,
    @Args('input') input: RegisterPushSubscriptionInput,
  ): Promise<boolean> {
    await this.push.register(companyId, currentUser.sub, input);
    return true;
  }

  @Mutation(() => Boolean)
  @RequireCompanyMembership()
  async unregisterPushSubscription(
    @CurrentCompanyId() companyId: string,
    @CurrentUser() currentUser: JwtPayload,
    @Args('endpoint') endpoint: string,
  ): Promise<boolean> {
    await this.push.unregister(companyId, currentUser.sub, endpoint);
    return true;
  }
}
