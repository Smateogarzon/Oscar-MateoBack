import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { UserLocationAccess } from './entities/user-location-access.entity.js';
import { UserLocationAccessResolver } from './user-location-access.resolver.js';
import { UserLocationAccessService } from './user-location-access.service.js';

@Module({
  imports: [TypeOrmModule.forFeature([UserLocationAccess])],
  providers: [UserLocationAccessService, UserLocationAccessResolver],
  exports: [UserLocationAccessService],
})
export class UserLocationAccessModule {}
