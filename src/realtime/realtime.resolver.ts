import { UseGuards } from '@nestjs/common';
import { Args, Resolver, Subscription } from '@nestjs/graphql';
import { CurrentCompanyId } from '../common/decorators/current-company.decorator.js';
import { CurrentUser } from '../common/decorators/current-user.decorator.js';
import { RequireCompanyMembership } from '../common/decorators/permissions.decorator.js';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard.js';
import { PermissionsGuard } from '../common/guards/permissions.guard.js';
import type { JwtPayload } from '../graphql/auth/interface/jwt-payload.interface.js';
import { NotificationChannel } from '../graphql/notification/entities/notification-channel.enum.js';
import { RealtimeEventObjectType } from './dto/realtime-event.object-type.js';
import type { RealtimeEvent } from './realtime-event.js';
import { RealtimeService } from './realtime.service.js';

// Sin CsrfGuard a propósito: el WebSocket no manda el encabezado CSRF, y lo que protege esta
// conexión es otra cosa (que el navegador que la abre venga del sitio de la app: ver wsOnConnect).
@Resolver(() => RealtimeEventObjectType)
@UseGuards(JwtAuthGuard, PermissionsGuard)
export class RealtimeResolver {
  constructor(private readonly realtime: RealtimeService) {}

  // Las señales en vivo de quien escucha, en la empresa activa: le llegan solo las suyas (el tema lo
  // decide la sesión, no un argumento). `channels` limita a los canales que le interesan. La escucha
  // se cierra sola cuando vence su sesión, y el cliente la vuelve a abrir.
  @Subscription(() => RealtimeEventObjectType, {
    resolve: (event: RealtimeEvent) => event,
  })
  @RequireCompanyMembership()
  notificationEvents(
    @CurrentCompanyId() companyId: string,
    @CurrentUser() currentUser: JwtPayload,
    @Args('channels', { type: () => [NotificationChannel], nullable: true })
    channels?: NotificationChannel[],
  ) {
    return this.realtime.subscribe(companyId, currentUser.sub, {
      channels,
      // `exp` viene en segundos
      expiresAt: currentUser.exp !== undefined ? currentUser.exp * 1000 : undefined,
    });
  }
}
