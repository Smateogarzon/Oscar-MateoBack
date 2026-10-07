import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { UserCompanyRole } from '../graphql/user-company-role/entities/user-company-role.entity.js';
import { PushSubscription } from './entities/push-subscription.entity.js';
import { PushResolver } from './push.resolver.js';
import { PushService } from './push.service.js';

// Los avisos del sistema (web push). No depende del tiempo real: el tiempo real lo llama para mandar el
// aviso a los dispositivos (ver RealtimeService), así que PushModule no importa RealtimeModule.
@Module({
  imports: [TypeOrmModule.forFeature([PushSubscription, UserCompanyRole])],
  providers: [PushService, PushResolver],
  exports: [PushService],
})
export class PushModule {}
