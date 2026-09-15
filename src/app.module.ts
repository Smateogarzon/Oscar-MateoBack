import './config/decimal.config.js';
import { envValidationSchema } from './config/env.validation.js';
import { DecimalScalar } from './common/scalars/decimal.scalar.js';
import { join } from 'node:path';
import { LoggerModule } from 'nestjs-pino';
import { Module } from '@nestjs/common';
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
        pinoHttp: {
          level: config.get('NODE_ENV') === 'production' ? 'info' : 'debug',
          transport:
            config.get('NODE_ENV') === 'production'
              ? undefined
              : { target: 'pino-pretty', options: { colorize: true } },
          redact: ['req.headers.authorization', 'req.headers.cookie'],
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
      autoSchemaFile: join(process.cwd(), 'src/schema.gql'),
      sortSchema: true,
      introspection: process.env.NODE_ENV !== 'production',
      validationRules,
      plugins: plugins as unknown as ApolloDriverConfig['plugins'],
      context: ({ req, res }: { req: Request; res: Response }) => ({
        req,
        res,
      }),
    }),
  ],
  controllers: [AppController],
  providers: [
    AppService,
    AppResolver,
    DecimalScalar,
    { provide: APP_GUARD, useClass: GqlThrottlerGuard },
    { provide: APP_FILTER, useClass: GqlAllExceptionsFilter },
  ],
})
export class AppModule {}
