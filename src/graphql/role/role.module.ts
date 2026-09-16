import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Role } from './entities/role.entity.js';
import { RoleResolver } from './role.resolver.js';
import { RoleService } from './role.service.js';

@Module({
  imports: [TypeOrmModule.forFeature([Role])],
  providers: [RoleService, RoleResolver],
  exports: [RoleService],
})
export class RoleModule {}
