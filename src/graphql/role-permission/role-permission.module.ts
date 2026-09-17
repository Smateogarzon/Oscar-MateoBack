import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { RolePermission } from './entities/role-permission.entity.js';
import { RolePermissionResolver } from './role-permission.resolver.js';
import { RolePermissionService } from './role-permission.service.js';

@Module({
  imports: [TypeOrmModule.forFeature([RolePermission])],
  providers: [RolePermissionService, RolePermissionResolver],
  exports: [RolePermissionService],
})
export class RolePermissionModule {}
