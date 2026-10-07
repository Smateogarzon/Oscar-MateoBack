import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { InternalOrderModule } from '../internal-order/internal-order.module.js';
import { NotificationModule } from '../notification/notification.module.js';
import { CashSessionResolver } from './cash-session.resolver.js';
import { CashSessionService } from './cash-session.service.js';
import { CashSession } from './entities/cash-session.entity.js';

@Module({
  imports: [TypeOrmModule.forFeature([CashSession]), NotificationModule, InternalOrderModule],
  providers: [CashSessionService, CashSessionResolver],
  exports: [CashSessionService],
})
export class CashSessionModule {}
