import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtModule } from '@nestjs/jwt';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Permission } from '../permission/entities/permission.entity.js';
import { Role } from '../role/entities/role.entity.js';
import { RolePermission } from '../role-permission/entities/role-permission.entity.js';
import { UserCompanyRole } from '../user-company-role/entities/user-company-role.entity.js';
import { UserModule } from '../user/user.module.js';
import { AuthResolver } from './auth.resolver.js';
import { AuthService } from './auth.service.js';

@Module({
  imports: [
    UserModule,
    TypeOrmModule.forFeature([Role, Permission, RolePermission, UserCompanyRole]),
    JwtModule.registerAsync({
      global: true,
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        secret: config.getOrThrow<string>('JWT_SECRET'),
      }),
    }),
  ],
  providers: [AuthService, AuthResolver],
  exports: [AuthService],
})
export class AuthModule {}
