import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Permission } from './entities/permission.entity.js';
import { PermissionResolver } from './permission.resolver.js';
import { PermissionService } from './permission.service.js';

@Module({
  imports: [TypeOrmModule.forFeature([Permission])],
  providers: [PermissionService, PermissionResolver],
  exports: [PermissionService],
})
export class PermissionModule {}
