import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AuditLogService } from './audit-log.service.js';
import { AuditLogSubscriber } from './audit-log.subscriber.js';
import { AuditLog } from './entities/audit-log.entity.js';

@Module({
  imports: [TypeOrmModule.forFeature([AuditLog])],
  providers: [AuditLogService, AuditLogSubscriber],
  exports: [AuditLogService],
})
export class AuditModule {}
