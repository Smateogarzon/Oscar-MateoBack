import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { NotificationModule } from '../notification/notification.module.js';
import { Incident } from './entities/incident.entity.js';
import { IncidentResolver } from './incident.resolver.js';
import { IncidentService } from './incident.service.js';

@Module({
  imports: [TypeOrmModule.forFeature([Incident]), NotificationModule],
  providers: [IncidentService, IncidentResolver],
  exports: [IncidentService],
})
export class IncidentModule {}
