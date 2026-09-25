import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { RealtimeModule } from '../../realtime/realtime.module.js';
import { Notification } from './entities/notification.entity.js';
import { UserNotification } from './entities/user-notification.entity.js';
import { NotificationResolver } from './notification.resolver.js';
import { NotificationService } from './notification.service.js';

@Module({
  imports: [
    TypeOrmModule.forFeature([Notification, UserNotification]),
    RealtimeModule,
  ],
  providers: [NotificationService, NotificationResolver],
  exports: [NotificationService],
})
export class NotificationModule {}
