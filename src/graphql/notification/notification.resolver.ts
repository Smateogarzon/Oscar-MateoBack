import { UseGuards } from '@nestjs/common';
import { Args, ID, Int, Mutation, Query, Resolver } from '@nestjs/graphql';
import { CurrentCompanyId } from '../../common/decorators/current-company.decorator.js';
import { CurrentUser } from '../../common/decorators/current-user.decorator.js';
import { RequireCompanyMembership } from '../../common/decorators/permissions.decorator.js';
import { CsrfGuard } from '../../common/guards/csrf.guard.js';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard.js';
import { PermissionsGuard } from '../../common/guards/permissions.guard.js';
import type { JwtPayload } from '../auth/interface/jwt-payload.interface.js';
import { NotificationObjectType } from './dto/notification.object-type.js';
import { NotificationChannel } from './entities/notification-channel.enum.js';
import { NotificationService } from './notification.service.js';

// Los avisos son de cada persona: cualquier miembro de la empresa activa lee y marca los suyos, y
// solo los suyos. No hay un permiso aparte.
@Resolver(() => NotificationObjectType)
@UseGuards(JwtAuthGuard, PermissionsGuard, CsrfGuard)
export class NotificationResolver {
  constructor(private readonly notificationService: NotificationService) {}

  // Los más recientes primero, de 30 en 30 por defecto (máximo 100).
  @Query(() => [NotificationObjectType])
  @RequireCompanyMembership()
  myNotifications(
    @CurrentCompanyId() companyId: string,
    @CurrentUser() currentUser: JwtPayload,
    @Args('channel', { type: () => NotificationChannel, nullable: true }) channel?: NotificationChannel,
    @Args('unreadOnly', { type: () => Boolean, nullable: true }) unreadOnly?: boolean,
    @Args('limit', { type: () => Int, nullable: true }) limit?: number,
    @Args('offset', { type: () => Int, nullable: true }) offset?: number,
  ) {
    return this.notificationService.findMine(companyId, currentUser.sub, {
      channel,
      unreadOnly,
      limit,
      offset,
    });
  }

  // Para el contador junto a "Notificaciones", en total o de un canal.
  @Query(() => Int)
  @RequireCompanyMembership()
  myUnreadNotificationsCount(
    @CurrentCompanyId() companyId: string,
    @CurrentUser() currentUser: JwtPayload,
    @Args('channel', { type: () => NotificationChannel, nullable: true }) channel?: NotificationChannel,
  ) {
    return this.notificationService.countUnread(companyId, currentUser.sub, channel);
  }

  // `id` es el de la notificación tal como la ve quien la recibe (el campo `id` de Notification).
  @Mutation(() => NotificationObjectType)
  @RequireCompanyMembership()
  markNotificationRead(
    @CurrentCompanyId() companyId: string,
    @CurrentUser() currentUser: JwtPayload,
    @Args('id', { type: () => ID }) id: string,
  ) {
    return this.notificationService.markRead(companyId, currentUser.sub, id);
  }

  // Devuelve cuántas marcó.
  @Mutation(() => Int)
  @RequireCompanyMembership()
  markAllNotificationsRead(
    @CurrentCompanyId() companyId: string,
    @CurrentUser() currentUser: JwtPayload,
    @Args('channel', { type: () => NotificationChannel, nullable: true }) channel?: NotificationChannel,
  ) {
    return this.notificationService.markAllRead(companyId, currentUser.sub, channel);
  }
}
