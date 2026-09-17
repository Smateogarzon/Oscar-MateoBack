import './config/decimal.config.js';
import { envValidationSchema } from './config/env.validation.js';
import { databaseSsl } from './config/database-ssl.js';
import { DecimalScalar } from './common/scalars/decimal.scalar.js';
import { join } from 'node:path';
import { LoggerModule } from 'nestjs-pino';
import { Module, RequestMethod } from '@nestjs/common';
import { APP_FILTER, APP_GUARD } from '@nestjs/core';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { ApolloDriver, type ApolloDriverConfig } from '@nestjs/apollo';
import { GraphQLModule } from '@nestjs/graphql';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ThrottlerModule, seconds } from '@nestjs/throttler';
import type { Request, Response } from 'express';
import { ApolloArmor } from '@escape.tech/graphql-armor';
import { AppController } from './app.controller.js';
import { AppService } from './app.service.js';
import { AppResolver } from './app.resolver.js';
import { GqlThrottlerGuard } from './common/guards/gql-throttler.guard.js';
import { GqlAllExceptionsFilter } from './common/filters/gql-all-exceptions.filter.js';
import { GraphqlLoggingPlugin } from './common/logging/graphql-logging.plugin.js';
import { AuthModule } from './graphql/auth/auth.module.js';
import { CompanyModule } from './graphql/company/company.module.js';
import { LocationModule } from './graphql/location/location.module.js';
import { PermissionModule } from './graphql/permission/permission.module.js';
import { RoleModule } from './graphql/role/role.module.js';
import { UserModule } from './graphql/user/user.module.js';
import { UserCompanyRoleModule } from './graphql/user-company-role/user-company-role.module.js';
import { RolePermissionModule } from './graphql/role-permission/role-permission.module.js';
import { UserLocationAccessModule } from './graphql/user-location-access/user-location-access.module.js';
import { StorageModule } from './common/storage/storage.module.js';
import { UploadModule } from './uploads/upload.module.js';

const { validationRules, plugins } = new ApolloArmor().protect();

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      validationSchema: envValidationSchema,
    }),
    LoggerModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        exclude: [{ path: 'graphql', method: RequestMethod.ALL }],
        pinoHttp: {
          level: config.get('NODE_ENV') === 'production' ? 'info' : 'debug',
          transport:
            config.get('NODE_ENV') === 'production'
              ? undefined
              : { target: 'pino-pretty', options: { colorize: true } },
          redact: ['req.headers.authorization', 'req.headers.cookie'],
          autoLogging: false,
        },
      }),
    }),
    ThrottlerModule.forRoot([
      {
        ttl: seconds(60),
        limit: 100,
      },
    ]),
    TypeOrmModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        type: 'postgres',
        host: config.getOrThrow<string>('DB_HOST'),
        port: config.getOrThrow<number>('DB_PORT'),
        username: config.getOrThrow<string>('DB_USER'),
        password: config.getOrThrow<string>('DB_PASSWORD'),
        database: config.getOrThrow<string>('DB_NAME'),
        ssl: databaseSsl(config.get<boolean>('DB_SSL') === true),
        autoLoadEntities: true,
        synchronize: false,
        extra: {
          max: config.get<number>('DB_POOL_MAX'),
          idleTimeoutMillis: config.get<number>('DB_POOL_IDLE_TIMEOUT_MS'),
          connectionTimeoutMillis: config.get<number>(
            'DB_POOL_CONNECTION_TIMEOUT_MS',
          ),
        },
      }),
    }),
    GraphQLModule.forRoot<ApolloDriverConfig>({
      driver: ApolloDriver,
      // En producción el schema se arma en memoria: el contenedor no trae src/ y
      // corre sin permisos de escritura.
      autoSchemaFile:
        process.env.NODE_ENV === 'production'
          ? true
          : join(process.cwd(), 'src/schema.gql'),
      sortSchema: true,
      introspection: process.env.NODE_ENV !== 'production',
      validationRules,
      plugins: plugins as unknown as ApolloDriverConfig['plugins'],
      context: ({ req, res }: { req: Request; res: Response }) => ({
        req,
        res,
      }),
    }),
    AuthModule,
    CompanyModule,
    LocationModule,
    PermissionModule,
    RoleModule,
    UserModule,
    UserCompanyRoleModule,
    RolePermissionModule,
    UserLocationAccessModule,
    StorageModule,
    UploadModule,
  ],
  controllers: [AppController],
  providers: [
    AppService,
    AppResolver,
    DecimalScalar,
    GraphqlLoggingPlugin,
    { provide: APP_GUARD, useClass: GqlThrottlerGuard },
    { provide: APP_FILTER, useClass: GqlAllExceptionsFilter },
  ],
})
export class AppModule {}
