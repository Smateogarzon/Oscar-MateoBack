import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { UserCompanyRole } from './entities/user-company-role.entity.js';
import { UserCompanyRoleResolver } from './user-company-role.resolver.js';
import { UserCompanyRoleService } from './user-company-role.service.js';

@Module({
  imports: [TypeOrmModule.forFeature([UserCompanyRole])],
  providers: [UserCompanyRoleService, UserCompanyRoleResolver],
  exports: [UserCompanyRoleService],
})
export class UserCompanyRoleModule {}
